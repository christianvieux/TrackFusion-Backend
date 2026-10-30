import { readFileSync } from "node:fs";
import {
  analyzeTerraformPlan,
  createPlanMetadata,
  decryptTerraformPlan,
  encryptTerraformPlan,
  renderPlanSummary,
  terraformPlanAad,
  verifyPlanMetadata,
} from "./terraformDeployment.js";

function planFixture(name) {
  return JSON.parse(readFileSync(
    `scripts/fixtures/terraform-plans/${name}`,
    "utf8",
  ));
}

const workflowEnvironment = {
  GITHUB_REPOSITORY: "example/trackfusionweb-api",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "2",
  TERRAFORM_VERSION: "1.17.0",
};

function planWith(...resourceChanges) {
  return { format_version: "1.2", resource_changes: resourceChanges };
}

function change(type, name, actions, before = null, after = null) {
  return {
    address: `${type}.${name}`,
    type,
    change: { actions, before, after },
  };
}

test("accepts a clean Terraform plan", () => {
  const analysis = analyzeTerraformPlan(planWith());

  expect(analysis).toMatchObject({ hasChanges: false, safe: true });
  expect(analysis.changes).toEqual([]);
});

test("accepts an allowlisted in-place S3 CORS update", () => {
  const analysis = analyzeTerraformPlan(planWith(
    change(
      "aws_s3_bucket_cors_configuration",
      "audio",
      ["update"],
      { bucket: "example", cors_rule: [{ allowed_origins: ["https://old.example"] }] },
      { bucket: "example", cors_rule: [{ allowed_origins: ["https://new.example"] }] },
    ),
  ));

  expect(analysis).toMatchObject({
    hasChanges: true,
    safe: true,
    counts: { create: 0, update: 1, delete: 0, replace: 0 },
  });
  expect(renderPlanSummary(analysis)).toContain(
    "`aws_s3_bucket_cors_configuration.audio`",
  );
  expect(renderPlanSummary(analysis)).toContain("`cors_rule`");
  expect(renderPlanSummary(analysis)).not.toContain("old.example");
  expect(renderPlanSummary(analysis)).not.toContain("new.example");
});

test.each([
  [["delete"], "delete"],
  [["delete", "create"], "replace"],
])("blocks destructive Terraform actions", (actions, expectedAction) => {
  const analysis = analyzeTerraformPlan(planWith(
    change("aws_s3_bucket_cors_configuration", "audio", actions),
  ));

  expect(analysis.safe).toBe(false);
  expect(analysis.blocked[0]).toContain(expectedAction);
});

test("blocks IAM and KMS changes from the ordinary deployment path", () => {
  const analysis = analyzeTerraformPlan(planWith(
    change("aws_iam_policy", "unexpected", ["create"]),
    change("aws_kms_key", "unexpected", ["update"]),
  ));

  expect(analysis.safe).toBe(false);
  expect(analysis.blocked).toHaveLength(2);
  expect(analysis.blocked.every((reason) => reason.includes("bootstrap path"))).toBe(true);
});

test("blocks an unrecognized resource action even when it is nondestructive", () => {
  const analysis = analyzeTerraformPlan(planWith(
    change("aws_lambda_function", "unexpected", ["create"]),
  ));

  expect(analysis.safe).toBe(false);
});

test("accepts the declared ingress policy and deliberate IPv4 egress", () => {
  const plan = planFixture("safe-network-update.json");
  const analysis = analyzeTerraformPlan(plan);
  const summary = renderPlanSummary(analysis);

  expect(analysis).toMatchObject({
    hasChanges: true,
    safe: true,
    counts: { create: 2, update: 2, delete: 0, replace: 0 },
  });
  expect(summary).not.toContain("198.51.100.23/32");
  expect(summary).not.toContain("198.51.100.24/32");
  expect(summary).not.toContain("0.0.0.0/0");
});

test("blocks a standalone rule that exposes SSH publicly without reporting CIDRs", () => {
  const analysis = analyzeTerraformPlan(
    planFixture("malicious-public-ssh.json"),
  );
  const summary = renderPlanSummary(analysis);

  expect(analysis.safe).toBe(false);
  expect(analysis.blocked).toEqual([
    expect.stringContaining("does not match the TrackFusionWeb network policy"),
  ]);
  expect(summary).not.toContain("198.51.100.24/32");
  expect(summary).not.toContain("0.0.0.0/0");
});

test("blocks unauthorized IPv6 represented inside the security group", () => {
  const analysis = analyzeTerraformPlan(
    planFixture("malicious-inline-ipv6.json"),
  );

  expect(analysis.safe).toBe(false);
  expect(analysis.blocked[0]).toContain("inline security-group rules");
  expect(renderPlanSummary(analysis)).not.toContain("::/0");
});

test.each([
  ["an unexpected ingress port", (plan) => {
    plan.resource_changes[1].change.after.from_port = 8080;
    plan.resource_changes[1].change.after.to_port = 8080;
  }],
  ["an unexpected ingress CIDR", (plan) => {
    plan.resource_changes[1].address = "aws_vpc_security_group_ingress_rule.http";
    plan.resource_changes[1].change.after.from_port = 80;
    plan.resource_changes[1].change.after.to_port = 80;
    plan.resource_changes[1].change.after.cidr_ipv4 = "10.0.0.0/8";
  }],
  ["IPv6 egress", (plan) => {
    plan.resource_changes[1].address = "aws_vpc_security_group_egress_rule.all_ipv4";
    plan.resource_changes[1].type = "aws_vpc_security_group_egress_rule";
    plan.resource_changes[1].change.after.ip_protocol = "-1";
    plan.resource_changes[1].change.after.from_port = null;
    plan.resource_changes[1].change.after.to_port = null;
    plan.resource_changes[1].change.after.cidr_ipv4 = null;
    plan.resource_changes[1].change.after.cidr_ipv6 = "::/0";
  }],
  ["an unknown security-relevant value", (plan) => {
    plan.resource_changes[1].change.after.cidr_ipv4 = null;
    plan.resource_changes[1].change.after_unknown = { cidr_ipv4: true };
  }],
])("blocks %s", (_description, mutate) => {
  const plan = planFixture("malicious-public-ssh.json");
  mutate(plan);
  const analysis = analyzeTerraformPlan(plan);
  const summary = renderPlanSummary(analysis);

  expect(analysis.safe).toBe(false);
  expect(summary).not.toContain("10.0.0.0/8");
  expect(summary).not.toContain("::/0");
});

test("blocks an undeclared rule even when its attributes otherwise look allowed", () => {
  const plan = planFixture("malicious-public-ssh.json");
  plan.resource_changes[1].address = "aws_vpc_security_group_ingress_rule.unexpected";
  plan.resource_changes[1].change.after.cidr_ipv4 = "198.51.100.24/32";

  const analysis = analyzeTerraformPlan(plan);
  expect(analysis.safe).toBe(false);
  expect(analysis.blocked[0]).toContain("not a declared TrackFusionWeb network rule");
});

test("blocks rules targeting an unresolved or different security group", () => {
  const plan = planFixture("safe-network-update.json");
  plan.resource_changes[1].change.after.security_group_id = "sg-0fedcba9876543210";

  const analysis = analyzeTerraformPlan(plan);
  expect(analysis.safe).toBe(false);
  expect(analysis.blocked[0]).not.toContain("sg-0fedcba9876543210");
});

test("encrypts and authenticates a Terraform plan for one workflow run", () => {
  const plaintext = Buffer.from("opaque terraform plan bytes");
  const key = Buffer.alloc(32, 7);
  const aad = terraformPlanAad(workflowEnvironment);
  const envelope = encryptTerraformPlan(plaintext, key, aad, Buffer.alloc(12, 3));

  expect(decryptTerraformPlan(envelope, key, aad)).toEqual(plaintext);

  const tampered = Buffer.from(envelope);
  tampered[tampered.length - 1] ^= 1;
  expect(() => decryptTerraformPlan(tampered, key, aad)).toThrow();
  expect(() => decryptTerraformPlan(
    envelope,
    key,
    terraformPlanAad({ ...workflowEnvironment, GITHUB_RUN_ATTEMPT: "3" }),
  )).toThrow();
});

test("binds plan metadata to the commit, run, version, checksum, and age", () => {
  const plan = Buffer.from("reviewed plan");
  const createdAt = new Date("2026-10-29T12:00:00.000Z");
  const metadata = createPlanMetadata(plan, workflowEnvironment, createdAt);

  expect(verifyPlanMetadata(
    metadata,
    workflowEnvironment,
    plan,
    new Date("2026-10-29T13:00:00.000Z"),
  )).toBe(true);

  expect(() => verifyPlanMetadata(
    metadata,
    { ...workflowEnvironment, GITHUB_SHA: "b".repeat(40) },
    plan,
    new Date("2026-10-29T13:00:00.000Z"),
  )).toThrow("commit does not match");

  expect(() => verifyPlanMetadata(
    metadata,
    workflowEnvironment,
    Buffer.from("different plan"),
    new Date("2026-10-29T13:00:00.000Z"),
  )).toThrow("checksum");

  expect(() => verifyPlanMetadata(
    metadata,
    workflowEnvironment,
    plan,
    new Date("2026-10-29T19:00:01.000Z"),
  )).toThrow("stale");
});

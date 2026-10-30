import {
  analyzeTerraformPlan,
  createPlanMetadata,
  decryptTerraformPlan,
  encryptTerraformPlan,
  renderPlanSummary,
  terraformPlanAad,
  verifyPlanMetadata,
} from "./terraformDeployment.js";

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

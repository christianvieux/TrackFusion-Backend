import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const ENVELOPE_MAGIC = Buffer.from("TFPLAN01", "ascii");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAN_AGE_SECONDS = 6 * 60 * 60;

const AUTOMATED_ACTIONS = new Map([
  ["aws_s3_bucket", new Set(["update"])],
  ["aws_s3_bucket_ownership_controls", new Set(["update"])],
  ["aws_s3_bucket_public_access_block", new Set(["update"])],
  ["aws_s3_bucket_server_side_encryption_configuration", new Set(["update"])],
  ["aws_s3_bucket_cors_configuration", new Set(["update"])],
  ["aws_instance", new Set(["update"])],
  ["aws_security_group", new Set(["update"])],
  ["aws_vpc_security_group_ingress_rule", new Set(["create", "update"])],
  ["aws_vpc_security_group_egress_rule", new Set(["create", "update"])],
  ["aws_eip", new Set(["update"])],
  ["aws_eip_association", new Set(["update"])],
  ["aws_ssm_document", new Set(["update"])],
  ["aws_sns_topic", new Set(["create", "update"])],
  ["aws_sns_topic_subscription", new Set(["create", "update"])],
  ["aws_cloudwatch_metric_alarm", new Set(["create", "update"])],
]);

function requireString(value, name, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${name} is missing or invalid`);
  }
  return value;
}

function planAction(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return "invalid";
  if (actions.includes("delete")) {
    return actions.includes("create") ? "replace" : "delete";
  }
  if (actions.length === 1 && ["create", "update", "read", "no-op"].includes(actions[0])) {
    return actions[0];
  }
  return "invalid";
}

function changedAttributeNames(change) {
  const before = change?.before && typeof change.before === "object" ? change.before : {};
  const after = change?.after && typeof change.after === "object" ? change.after : {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]))
    .filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
    .sort();
}

export function analyzeTerraformPlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.resource_changes)) {
    throw new Error("Terraform plan JSON is missing resource_changes");
  }

  const changes = [];
  const blocked = [];
  const counts = { create: 0, update: 0, delete: 0, replace: 0 };

  for (const resource of plan.resource_changes) {
    const action = planAction(resource.change?.actions);
    if (["no-op", "read"].includes(action)) continue;

    const address = requireString(
      resource.address,
      "Terraform resource address",
      /^[A-Za-z0-9_.\[\]"-]+$/,
    );
    const type = requireString(
      resource.type,
      "Terraform resource type",
      /^[a-z0-9_]+$/,
    );

    changes.push({
      action,
      address,
      type,
      attributes: changedAttributeNames(resource.change),
    });
    if (Object.hasOwn(counts, action)) counts[action] += 1;

    if (["delete", "replace", "invalid"].includes(action)) {
      blocked.push(`${address}: ${action} actions are not allowed`);
      continue;
    }

    const allowedActions = AUTOMATED_ACTIONS.get(type);
    if (!allowedActions?.has(action)) {
      blocked.push(
        `${address}: ${action} for ${type} requires the administrator bootstrap path`,
      );
    }
  }

  return {
    hasChanges: changes.length > 0,
    safe: blocked.length === 0,
    changes,
    blocked,
    counts,
  };
}

export function renderPlanSummary(analysis) {
  const lines = [
    "### Terraform plan safety gate",
    "",
    "Only resource addresses and actions are shown; plan values remain encrypted.",
    "",
    "| Create | Update | Delete | Replace | Result |",
    "| ---: | ---: | ---: | ---: | --- |",
    `| ${analysis.counts.create} | ${analysis.counts.update} | ${analysis.counts.delete} | ${analysis.counts.replace} | ${analysis.safe ? "eligible for approval" : "blocked"} |`,
  ];

  if (analysis.changes.length > 0) {
    lines.push(
      "",
      "| Action | Resource address | Changed top-level attributes |",
      "| --- | --- | --- |",
    );
    for (const change of analysis.changes) {
      const attributes = change.attributes.length > 0
        ? change.attributes.map((name) => `\`${name}\``).join(", ")
        : "not reported";
      lines.push(`| ${change.action} | \`${change.address}\` | ${attributes} |`);
    }
  }

  if (analysis.blocked.length > 0) {
    lines.push("", "Blocked reasons:");
    for (const reason of analysis.blocked) lines.push(`- ${reason}`);
  }

  return `${lines.join("\n")}\n`;
}

function deploymentIdentity(environment = process.env) {
  return {
    repository: requireString(
      environment.GITHUB_REPOSITORY,
      "GITHUB_REPOSITORY",
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    ),
    commit: requireString(environment.GITHUB_SHA, "GITHUB_SHA", /^[0-9a-f]{40}$/),
    runId: requireString(environment.GITHUB_RUN_ID, "GITHUB_RUN_ID", /^[0-9]+$/),
    runAttempt: requireString(
      environment.GITHUB_RUN_ATTEMPT,
      "GITHUB_RUN_ATTEMPT",
      /^[1-9][0-9]*$/,
    ),
  };
}

export function terraformPlanAad(environment = process.env) {
  const identity = deploymentIdentity(environment);
  return Buffer.from([
    `Repository=${identity.repository}`,
    `Commit=${identity.commit}`,
    `RunId=${identity.runId}`,
    `RunAttempt=${identity.runAttempt}`,
    "Purpose=TerraformPlan",
  ].join("\n"), "utf8");
}

function readDataKey(path) {
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error("Terraform plan data key must be exactly 32 bytes");
  return key;
}

function writePrivateFile(path, value) {
  writeFileSync(path, value, { flag: "wx", mode: 0o600 });
  chmodSync(path, 0o600);
}

export function encryptTerraformPlan(plaintext, key, aad, nonce = randomBytes(NONCE_BYTES)) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length === 0) {
    throw new Error("Terraform plan plaintext must not be empty");
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Terraform plan data key must be exactly 32 bytes");
  }
  if (!Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES) {
    throw new Error("Terraform plan nonce must be exactly 12 bytes");
  }

  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([ENVELOPE_MAGIC, nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptTerraformPlan(envelope, key, aad) {
  const headerLength = ENVELOPE_MAGIC.length + NONCE_BYTES + TAG_BYTES;
  if (!Buffer.isBuffer(envelope) || envelope.length <= headerLength) {
    throw new Error("Encrypted Terraform plan envelope is invalid");
  }
  if (!envelope.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) {
    throw new Error("Encrypted Terraform plan envelope has an unknown format");
  }

  const nonceStart = ENVELOPE_MAGIC.length;
  const tagStart = nonceStart + NONCE_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const nonce = envelope.subarray(nonceStart, tagStart);
  const tag = envelope.subarray(tagStart, ciphertextStart);
  const ciphertext = envelope.subarray(ciphertextStart);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createPlanMetadata(plan, environment = process.env, now = new Date()) {
  const identity = deploymentIdentity(environment);
  return {
    version: 1,
    ...identity,
    terraformVersion: requireString(
      environment.TERRAFORM_VERSION,
      "TERRAFORM_VERSION",
      /^[0-9]+\.[0-9]+\.[0-9]+$/,
    ),
    createdAt: now.toISOString(),
    planSha256: sha256(plan),
  };
}

export function verifyPlanMetadata(
  metadata,
  environment = process.env,
  plan = null,
  now = new Date(),
) {
  const expected = deploymentIdentity(environment);
  if (metadata?.version !== 1) throw new Error("Terraform plan metadata version is invalid");
  for (const [name, value] of Object.entries(expected)) {
    if (metadata[name] !== value) {
      throw new Error(`Terraform plan metadata ${name} does not match this workflow run`);
    }
  }
  if (metadata.terraformVersion !== environment.TERRAFORM_VERSION) {
    throw new Error("Terraform plan metadata version does not match the apply runtime");
  }
  requireString(metadata.planSha256, "planSha256", /^[0-9a-f]{64}$/);
  const createdAt = Date.parse(metadata.createdAt);
  const ageSeconds = (now.getTime() - createdAt) / 1000;
  if (!Number.isFinite(createdAt) || ageSeconds < 0 || ageSeconds > MAX_PLAN_AGE_SECONDS) {
    throw new Error("Terraform plan is stale; generate and approve a new plan");
  }
  if (plan && sha256(plan) !== metadata.planSha256) {
    throw new Error("Decrypted Terraform plan checksum does not match its metadata");
  }
  return true;
}

function usage() {
  return [
    "Usage:",
    "  terraformDeployment.js analyze <plan.json> <summary.md>",
    "  terraformDeployment.js encrypt <plan> <encrypted-plan> <key-file>",
    "  terraformDeployment.js decrypt <encrypted-plan> <plan> <key-file>",
    "  terraformDeployment.js metadata-create <plan> <metadata.json>",
    "  terraformDeployment.js metadata-verify <metadata.json> [plan]",
  ].join("\n");
}

export function runCli(argv = process.argv.slice(2), environment = process.env) {
  const [command, ...args] = argv;
  if (command === "analyze" && args.length === 2) {
    const analysis = analyzeTerraformPlan(JSON.parse(readFileSync(args[0], "utf8")));
    writePrivateFile(args[1], renderPlanSummary(analysis));
    if (!analysis.safe) throw new Error("Terraform plan contains blocked actions");
    console.log(analysis.hasChanges ? "Terraform plan is safe for approval" : "Terraform plan has no resource changes");
    return;
  }
  if (command === "encrypt" && args.length === 3) {
    writePrivateFile(
      args[1],
      encryptTerraformPlan(readFileSync(args[0]), readDataKey(args[2]), terraformPlanAad(environment)),
    );
    return;
  }
  if (command === "decrypt" && args.length === 3) {
    writePrivateFile(
      args[1],
      decryptTerraformPlan(readFileSync(args[0]), readDataKey(args[2]), terraformPlanAad(environment)),
    );
    return;
  }
  if (command === "metadata-create" && args.length === 2) {
    const plan = readFileSync(args[0]);
    writePrivateFile(
      args[1],
      `${JSON.stringify(createPlanMetadata(plan, environment), null, 2)}\n`,
    );
    return;
  }
  if (command === "metadata-verify" && [1, 2].includes(args.length)) {
    const metadata = JSON.parse(readFileSync(args[0], "utf8"));
    verifyPlanMetadata(
      metadata,
      environment,
      args[1] ? readFileSync(args[1]) : null,
    );
    console.log("Terraform plan metadata verified");
    return;
  }
  throw new Error(usage());
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/terraformDeployment.js")) {
  try {
    runCli();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

import { readFileSync } from "node:fs";

const deploy = readFileSync("deploy/ec2/deploy-release.sh", "utf8");
const backup = readFileSync("deploy/ec2/backup-release.sh", "utf8");
const rollback = readFileSync("deploy/ec2/rollback-release.sh", "utf8");
const compose = readFileSync("compose.yaml", "utf8");
const workflow = readFileSync(".github/workflows/ci-cd.yml", "utf8");
const server = readFileSync("index.js", "utf8");
const environmentValidator = readFileSync(
  "scripts/validateEnvironment.js",
  "utf8",
);

test("validates startup configuration before initializing services", () => {
  const validation = server.indexOf("validateEnvironment()");
  const serviceInitialization = server.indexOf('await import("http")');

  expect(validation).toBeGreaterThan(-1);
  expect(serviceInitialization).toBeGreaterThan(validation);
  expect(server).not.toContain("initializeEnvironment");
});

test("keeps the standalone environment validator local and compatible", () => {
  expect(environmentValidator).toContain("validateEnvironment()");
  expect(environmentValidator).not.toContain("initializeEnvironment");
});

test("validates a reconciled candidate before stopping the running service", () => {
  const reconciliation = deploy.lastIndexOf("reconcile-production-environment.sh");
  const validation = deploy.lastIndexOf("scripts/validateEnvironment.js");
  const serviceStop = deploy.indexOf('systemctl stop "${service_name}"');

  expect(reconciliation).toBeGreaterThan(-1);
  expect(validation).toBeGreaterThan(reconciliation);
  expect(serviceStop).toBeGreaterThan(validation);
});

test("atomically installs the environment only after a protected backup", () => {
  const backupCreation = deploy.indexOf('backup_directory=$(bash "${staging_directory}/deploy/ec2/backup-release.sh"');
  const pendingCreation = deploy.indexOf('mktemp "${config_directory}/.env.XXXXXX"');
  const atomicMove = deploy.indexOf('mv -- "${pending_environment}" "${environment_file}"');

  expect(backupCreation).toBeLessThan(pendingCreation);
  expect(pendingCreation).toBeLessThan(atomicMove);
  expect(deploy).toContain('install -o root -g root -m 0600 "${candidate_environment}"');
  expect(backup).toContain('rsync -a --delete "${config_directory}/"');
});

test("interrupts and failed health checks enter the existing rollback path", () => {
  expect(deploy).toContain("trap handle_exit EXIT");
  expect(deploy).toContain("trap 'exit 130' INT");
  expect(deploy).toContain("trap 'exit 143' HUP TERM");
  expect(deploy).toMatch(
    /if \[\[ \$\{deployment_started\} == true[\s\S]*?rollback-release\.sh/,
  );
  expect(deploy).toMatch(
    /if ! wait_for_health; then[\s\S]*?post-installation application or Nginx health check failed[\s\S]*?exit 1/,
  );
  expect(rollback).toContain('rsync -a --delete "${backup_directory}/config/"');
  expect(rollback).toContain("Rollback health checks passed.");
});

test("keeps local Compose independent from production Parameter Store", () => {
  for (const service of ["postgres", "redis", "storage", "mailpit", "api"]) {
    expect(compose).toMatch(new RegExp(`^  ${service}:`, "m"));
  }
  expect(compose).not.toContain("ssm-parameter-store");
  expect(compose).not.toContain("/trackfusionweb/production/api/");
  expect(compose).toContain('AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:-}');
  expect(compose).toContain('AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:-}');
});

test("runs the AWS-mocked reconciliation suite in ordinary CI", () => {
  expect(workflow).toContain(
    "bash deploy/ec2/tests/parameter-store-reconciliation.test.sh",
  );
});

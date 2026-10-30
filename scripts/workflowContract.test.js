import { readFileSync } from "node:fs";

const workflow = readFileSync(
  ".github/workflows/ci-cd.yml",
  "utf8",
);
const deploymentAutomation = readFileSync(
  "infrastructure/terraform/deployment-automation.tf",
  "utf8",
);

function section(start, end) {
  const startIndex = workflow.indexOf(start);
  const endIndex = workflow.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing workflow section: ${start}`);
  return workflow.slice(startIndex, endIndex);
}

test("keeps production manual and serial without cancelling an apply", () => {
  expect(workflow).toContain("github.event_name != 'workflow_dispatch'");
  expect(workflow).toContain("github.ref != 'refs/heads/main'");
  expect(workflow).toContain(
    "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
  );
});

test("checks enforceable GitHub protections before any production AWS role", () => {
  const preflight = section("  production-preflight:", "  terraform-plan:");
  const plan = section("  terraform-plan:", "  terraform-apply:");

  expect(preflight).toContain("needs: [test, docker, terraform]");
  expect(preflight).toContain("node scripts/verifyProductionEnvironments.js");
  expect(preflight).not.toContain("id-token: write");
  expect(preflight).not.toContain("configure-aws-credentials");
  expect(plan).toContain("needs: production-preflight");
  expect(plan).toContain("name: production-plan");
});

test("uses distinct OIDC roles and a reviewer-gated apply environment", () => {
  const plan = section("  terraform-plan:", "  terraform-apply:");
  const apply = section("  terraform-apply:", "  deploy:");
  const deploy = workflow.slice(workflow.indexOf("  deploy:"));

  expect(plan).toContain("TrackFusionWeb-GitHub-Terraform-Plan_Role");
  expect(apply).toContain("TrackFusionWeb-GitHub-Terraform-Apply_Role");
  expect(apply).toContain("name: production-infrastructure");
  expect(deploy).toContain("TrackFusionWeb-GitHub-Deploy_Role");
});

test("saves, safety-checks, and encrypts the real plan without publishing plaintext", () => {
  const plan = section("  terraform-plan:", "  terraform-apply:");

  expect(plan).toContain("-detailed-exitcode");
  expect(plan).toContain("-lock-timeout=5m");
  expect(plan).toContain('node scripts/terraformDeployment.js analyze "$plan_json"');
  expect(plan).toContain('node scripts/terraformDeployment.js encrypt');
  expect(plan).toContain("production.tfplan.encrypted");
  expect(plan).not.toMatch(/runner\.temp \/terraform-plan\/production\.tfplan\s*$/m);
  expect(plan).toContain("retention-days: 1");
});

test("fails closed when credentials, identity verification, or planning fails", () => {
  const plan = section("  terraform-plan:", "  terraform-apply:");

  expect(plan.indexOf("Configure read-only Terraform credentials")).toBeLessThan(
    plan.indexOf("Initialize the remote backend"),
  );
  expect(plan).toContain("aws sts get-caller-identity");
  expect(plan).toContain('echo "::error::Terraform planning failed;');
  expect(plan).toMatch(/\*\)\n\s+echo "::error::Terraform planning failed;[\s\S]*?exit 1/);
  expect(plan).not.toContain("continue-on-error: true");
});

test("rechecks commit-bound plan integrity and blocks deployment after apply failure", () => {
  const apply = section("  terraform-apply:", "  deploy:");
  const deploy = workflow.slice(workflow.indexOf("  deploy:"));

  expect(apply).toContain("ref: ${{ github.sha }}");
  expect(apply).toContain("metadata-verify");
  expect(apply).toContain("production.tfplan.encrypted");
  expect(apply).toContain('terraform -chdir=infrastructure/terraform apply');
  expect(apply).toMatch(/Terraform apply failed;[\s\S]*?exit 1/);
  expect(deploy).toContain("needs.terraform-apply.result == 'success'");
  expect(deploy).toContain("needs.terraform-plan.outputs.has_changes == 'false'");
});

test("withholds plan and apply diagnostics from workflow logs", () => {
  const plan = section("  terraform-plan:", "  terraform-apply:");
  const apply = section("  terraform-apply:", "  deploy:");

  expect(plan).toContain('>"$plan_log" 2>&1');
  expect(apply).toContain('>"$apply_log" 2>&1');
  expect(plan).not.toContain('cat "$plan_log"');
  expect(apply).not.toContain('cat "$apply_log"');
});

test("scopes monitoring writes to the managed alarms and optional email topic", () => {
  expect(deploymentAutomation).toContain(
    "resources = local.monitoring_alarm_arns",
  );
  expect(deploymentAutomation).toContain(
    "resources = [local.monitoring_alert_topic_arn]",
  );
  expect(deploymentAutomation).toContain(
    'variable = "cloudwatch:AlarmActions"',
  );
  expect(deploymentAutomation).toContain('variable = "sns:Protocol"');
  expect(deploymentAutomation).not.toMatch(
    /sid\s+=\s+"UpdateMonitoring"[\s\S]*?resources\s+=\s+\["\*"\]/,
  );
});

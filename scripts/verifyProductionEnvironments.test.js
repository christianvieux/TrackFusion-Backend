import { verifyProductionEnvironments } from "./verifyProductionEnvironments.js";

function mainOnlyEnvironment(overrides = {}) {
  return {
    environment: {
      can_admins_bypass: true,
      protection_rules: [{ type: "branch_policy" }],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
      ...overrides,
    },
    branchPolicies: {
      total_count: 1,
      branch_policies: [{ name: "main", type: "branch" }],
    },
  };
}

function validConfiguration() {
  return {
    "production-plan": mainOnlyEnvironment(),
    "production-infrastructure": mainOnlyEnvironment({
      can_admins_bypass: false,
      protection_rules: [
        { type: "branch_policy" },
        {
          type: "required_reviewers",
          prevent_self_review: true,
          reviewers: [{ type: "User", reviewer: { login: "reviewer" } }],
        },
      ],
    }),
    production: mainOnlyEnvironment(),
  };
}

test("accepts main-only environments with enforceable infrastructure approval", () => {
  expect(verifyProductionEnvironments(validConfiguration())).toBe(true);
});

test("fails closed when the infrastructure environment is missing", () => {
  const configuration = validConfiguration();
  delete configuration["production-infrastructure"];

  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "production-infrastructure",
  );
});

test("rejects an environment without required reviewers", () => {
  const configuration = validConfiguration();
  configuration["production-infrastructure"] = mainOnlyEnvironment({
    can_admins_bypass: false,
  });

  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "require reviewers",
  );
});

test("rejects self-review and administrator bypass", () => {
  const configuration = validConfiguration();
  configuration["production-infrastructure"].environment.can_admins_bypass = true;
  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "disallow administrator bypass",
  );

  configuration["production-infrastructure"].environment.can_admins_bypass = false;
  configuration["production-infrastructure"].environment.protection_rules[1]
    .prevent_self_review = false;
  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "prevent self-review",
  );
});

test("rejects non-main or unrestricted deployment branches", () => {
  const configuration = validConfiguration();
  configuration["production-plan"].branchPolicies.branch_policies[0].name = "*";
  expect(() => verifyProductionEnvironments(configuration)).toThrow("only the main branch");

  configuration["production-plan"] = mainOnlyEnvironment();
  configuration.production.environment.deployment_branch_policy = {
    protected_branches: false,
    custom_branch_policies: false,
  };
  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "selected deployment branches",
  );
});

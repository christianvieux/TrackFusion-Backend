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
          prevent_self_review: false,
          reviewers: [{ type: "User", reviewer: { login: "solo-maintainer" } }],
        },
      ],
    }),
    production: mainOnlyEnvironment(),
  };
}

test("accepts main-only environments with solo-maintainer infrastructure approval", () => {
  expect(verifyProductionEnvironments(validConfiguration())).toBe(true);
});

test.each(["production-plan", "production-infrastructure", "production"])(
  "fails closed when the %s environment is missing",
  (name) => {
    const configuration = validConfiguration();
    delete configuration[name];

    expect(() => verifyProductionEnvironments(configuration)).toThrow(name);
  },
);

test("rejects an environment without required reviewers", () => {
  const configuration = validConfiguration();
  configuration["production-infrastructure"] = mainOnlyEnvironment({
    can_admins_bypass: false,
  });

  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "require reviewers",
  );
});

test("rejects a required-reviewer rule without an eligible reviewer", () => {
  const configuration = validConfiguration();
  configuration["production-infrastructure"].environment.protection_rules[1].reviewers =
    [];

  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "at least one eligible reviewer",
  );
});

test("rejects administrator bypass", () => {
  const configuration = validConfiguration();
  configuration["production-infrastructure"].environment.can_admins_bypass = true;
  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "disallow administrator bypass",
  );
});

test("rejects self-review prevention for the solo-maintainer model", () => {
  const configuration = validConfiguration();
  configuration["production-infrastructure"].environment.protection_rules[1]
    .prevent_self_review = true;
  expect(() => verifyProductionEnvironments(configuration)).toThrow(
    "permit reviewer self-approval",
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

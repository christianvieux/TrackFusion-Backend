import { readFileSync } from "node:fs";

const REQUIRED_ENVIRONMENTS = [
  "production-plan",
  "production-infrastructure",
  "production",
];

function verifyMainOnlyBranchPolicy(name, environment, branchPolicies) {
  if (
    environment?.deployment_branch_policy?.custom_branch_policies !== true ||
    environment?.deployment_branch_policy?.protected_branches !== false
  ) {
    throw new Error(`${name} must use selected deployment branches`);
  }
  const policies = branchPolicies?.branch_policies;
  if (
    !Array.isArray(policies) ||
    policies.length !== 1 ||
    policies[0]?.name !== "main" ||
    policies[0]?.type !== "branch"
  ) {
    throw new Error(`${name} must allow only the main branch`);
  }
}

export function verifyProductionEnvironments(configuration) {
  for (const name of REQUIRED_ENVIRONMENTS) {
    const entry = configuration[name];
    if (!entry?.environment || !entry?.branchPolicies) {
      throw new Error(`GitHub environment is missing or unreadable: ${name}`);
    }
    verifyMainOnlyBranchPolicy(name, entry.environment, entry.branchPolicies);
  }

  const infrastructure = configuration["production-infrastructure"].environment;
  if (infrastructure.can_admins_bypass !== false) {
    throw new Error("production-infrastructure must disallow administrator bypass");
  }
  const reviewerRule = infrastructure.protection_rules?.find(
    ({ type }) => type === "required_reviewers",
  );
  if (!reviewerRule) {
    throw new Error("production-infrastructure must require reviewers");
  }
  if (!Array.isArray(reviewerRule.reviewers) || reviewerRule.reviewers.length < 1) {
    throw new Error("production-infrastructure must have at least one eligible reviewer");
  }
  if (reviewerRule.prevent_self_review !== false) {
    throw new Error(
      "production-infrastructure must permit reviewer self-approval for the solo-maintainer model",
    );
  }

  return true;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return response.json();
}

export async function fetchEnvironmentConfiguration(repository, apiBaseUrl) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY is invalid");
  }
  const base = `${apiBaseUrl.replace(/\/$/, "")}/repos/${repository}/environments`;
  const configuration = {};
  for (const name of REQUIRED_ENVIRONMENTS) {
    const encodedName = encodeURIComponent(name);
    const [environment, branchPolicies] = await Promise.all([
      fetchJson(`${base}/${encodedName}`),
      fetchJson(`${base}/${encodedName}/deployment-branch-policies`),
    ]);
    configuration[name] = { environment, branchPolicies };
  }
  return configuration;
}

export async function runCli(argv = process.argv.slice(2), environment = process.env) {
  let configuration;
  if (argv[0] === "--fixture" && argv[1] && argv.length === 2) {
    configuration = JSON.parse(readFileSync(argv[1], "utf8"));
  } else if (argv.length === 0) {
    configuration = await fetchEnvironmentConfiguration(
      environment.GITHUB_REPOSITORY || "",
      environment.GITHUB_API_URL || "https://api.github.com",
    );
  } else {
    throw new Error("Usage: verifyProductionEnvironments.js [--fixture file.json]");
  }
  verifyProductionEnvironments(configuration);
  console.log("GitHub production environment protections verified");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/verifyProductionEnvironments.js")) {
  runCli().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}

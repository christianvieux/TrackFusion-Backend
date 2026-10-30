# Production deployment orchestration

Status: implemented in code, intentionally blocked pending one-time AWS and
GitHub protection setup.

Phase 3 production secret reconciliation is implemented but remains inactive.
Its authorized migration and activation procedure is documented in
[`production-secrets-runbook.md`](production-secrets-runbook.md).

This document covers the Phase 2 workflow only. The configuration inventory and
secret migration design remain in
[`deployment-architecture-audit.md`](deployment-architecture-audit.md).

## Deployment sequence

A manual dispatch of `main` uses this fail-closed sequence:

1. Run the existing application tests, dependency audit, Docker build, and
   backend-disabled Terraform validation.
2. Verify through the GitHub API that all production environments exist, allow
   only `main`, and that infrastructure apply requires a non-bypassable,
   non-self approval from an eligible reviewer.
3. Enter `production-plan`, assume the read-only Terraform OIDC role, initialize
   the real S3 backend, acquire the native S3 lock, and create a saved plan with
   detailed exit codes.
4. Continue directly to application deployment when the plan is clean.
5. For a changed plan, render only actions and resource addresses, block
   destructive/replacement/bootstrap-only/unrecognized changes, and encrypt the
   binary plan client-side with an AWS KMS data key.
6. Upload only the authenticated ciphertext, encrypted data key, and nonsecret
   commit/run metadata with one-day retention.
7. Wait at the `production-infrastructure` GitHub Environment. Its reviewer can
   review the redacted plan summary and exact commit before approving.
8. Assume the separate apply role, download the same run's immutable artifact,
   verify the commit/run/version/age metadata, decrypt and checksum the plan,
   rerun the safety gate, and apply only that saved plan.
9. If planning, approval, decryption, stale-state checking, locking, permission
   evaluation, or apply fails, do not run application deployment.
10. After a clean plan or successful apply, enter the existing `production`
    environment, assume only the application-deploy role, and run the existing
    checksummed S3/SSM deployment, rollback behavior, health checks, and artifact
    cleanup.

Production manual runs share one concurrency group and are not cancelled by a
later dispatch. Terraform also uses `-lock-timeout=5m`; a state serial change
between plan and apply makes the saved plan fail instead of silently replanning.
Normal pushes and pull requests cannot enter privileged jobs or request their
OIDC subjects.

Plan and apply diagnostics are not printed because Terraform output can contain
sensitive values. The plan summary contains only resource addresses and action
types. Approval must include review of both that summary and the dispatched
commit. The encrypted artifact is bound by KMS and AES-GCM authenticated data to
the repository, commit, workflow run, and run attempt; it expires after one day
and metadata rejects plans older than six hours.

## Current GitHub protection status

The public repository was inspected through the GitHub API on 2026-10-29.
`production` exists and allows only `main`, but it has no required reviewers and
allows administrator bypass. `production-plan` and
`production-infrastructure` do not exist. Therefore the committed preflight
fails before requesting AWS credentials. This is intentional.

Required-reviewer protection is available for public repositories, including
GitHub Free, Pro, and Team. GitHub documents that environment protection is
enforced before a referencing job proceeds and that environment secrets remain
unavailable until approval. See
[GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

### One-time GitHub setup

An administrator must complete and independently verify all of these settings:

1. Add or identify at least one reviewer with repository read access who is not
   the person dispatching production. The currently available eligible reviewer
   set could not be enumerated with the available API connection; do not weaken
   self-review protection to work around that limitation.
2. Create `production-plan`, select deployment branches, allow only the `main`
   branch, and add the nonsecret environment variable `DEVELOPER_SSH_CIDR` with
   the current administrative IPv4 `/32`. This environment must not have apply
   credentials or secret values.
3. Create `production-infrastructure`, select only `main`, configure at least one
   required reviewer, enable “prevent self-review,” and disable administrator
   bypass.
4. Keep `production` restricted to only `main`. Adding a separate application
   deployment reviewer is optional and would create a second approval after
   infrastructure apply.
5. Re-read the environment API or run the workflow. The preflight must pass
   without changing `scripts/verifyProductionEnvironments.js` or weakening its
   requirements.

Do not merely create the environment names. Referencing a missing environment
can create it without protection; the preflight is what prevents that unsafe
state from reaching AWS.

## One-time AWS bootstrap

The OIDC roles and KMS keys cannot create themselves. Using the authenticated
administrator profile, an operator must generate a fresh plan from the Phase 2
commit after reviewing the code. Do not reuse the earlier saved plan: it
predates these resources. The fresh bootstrap plan will include the new IAM/KMS
resources, the EC2 parameter-read policy, and any still-pending S3 CORS update.
Review every action and apply it only in a separately authorized session.

Bootstrap creates:

- `TrackFusionWeb-GitHub-Terraform-Plan_Role`, which can read the one production
  state object, use its lockfile, refresh only the declared AWS resource
  families, and generate a plan-artifact data key;
- `TrackFusionWeb-GitHub-Terraform-Apply_Role`, which can update the same state,
  decrypt an approved plan data key, and perform a deliberately restricted set
  of non-IAM mutations represented by the current configuration;
- a dedicated rotating KMS key for plan-artifact envelope encryption;
- a separate rotating KMS key for production Parameter Store values; and
- exact EC2 `ssm:GetParameters` and KMS decrypt permissions for the four
  allowlisted production parameters.

The ordinary apply role cannot mutate IAM, OIDC, or KMS. The plan safety gate
also classifies those resource types as bootstrap-only. A future identity or key
change therefore requires a fresh administrator-reviewed bootstrap plan rather
than self-expansion by the automation role.

HashiCorp documents that the plan role needs read access to the state object and
read/write/delete access only to its `.tflock`; the apply role additionally
needs `PutObject` on the state object. See the
[S3 backend permission model](https://developer.hashicorp.com/terraform/language/backend/s3#permissions-required).

After bootstrap, manually exercise each OIDC role with caller-identity and a
real no-change plan before relying on it. Missing read APIs or a mismatched OIDC
subject must fail the workflow; adjust only the narrowly scoped policy action
shown by CloudTrail or the AWS denial, then repeat bootstrap review.

## Parameter Store preparation

Terraform defines no parameters and no values. Phase 3 retains the exact
standard SecureString allowlist:

- `/trackfusionweb/production/api/SESSION_SECRET`
- `/trackfusionweb/production/api/JWT_SECRET`
- `/trackfusionweb/production/api/DATABASE_URL`
- `/trackfusionweb/production/api/RESEND_API_KEY`

The EC2 role can call only `ssm:GetParameters` on those four ARNs. It cannot use
`GetParameter`, history, or recursive path retrieval. GitHub plan, apply, and
application-deploy roles cannot read them.

This phase selects a customer-managed symmetric KMS key for these high-value
credentials. It adds a recurring KMS key/API cost, but permits an independent
decrypt boundary: EC2 decrypt is limited to calls through SSM and to the exact
`PARAMETER_ARN` encryption contexts. The cheaper AWS-managed `alias/aws/ssm`
key was rejected because AWS grants its decrypt use to all IAM principals in
the account; parameter IAM remains a control, but the key cannot provide a
second principal-specific boundary. AWS documents this limitation in
[Restricting SecureString decryption](https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-restrict-decryption.html).

The Phase 3 implementation retrieves these exact names only after an explicit
host-side selection. The one-time operator must create standard SecureString
parameters with the Terraform output `production_parameter_kms_key_arn`. Do not
create placeholders, put values in Terraform variables/state, or rotate the
existing credentials during migration. Follow the
[production secrets runbook](production-secrets-runbook.md) for cutover and
rollback.

## Production origin and S3 CORS

`deploy/ec2/production-managed.env` remains the Git-managed runtime source of
truth. Terraform parses its `FRONTEND_URL` and always includes that exact HTTPS
origin in S3 CORS. `var.frontend_origins` now means additional nonproduction S3
origins only. API CORS remains independently expressed by
`CORS_ALLOWED_ORIGINS`, because API requests and presigned S3 browser requests
have different method/header requirements. The application validator still
requires production API CORS to include `FRONTEND_URL`.

This produces a deterministic shared canonical production origin without
pretending the API and bucket CORS policies are the same policy. No bucket CORS
or policy was changed while implementing Phase 2.

## Verification boundary

Fixture and contract tests cover clean and changed plans, planning failure,
destructive and bootstrap-only changes, ciphertext tampering, commit/run/stale
metadata, missing or weak GitHub environments, self-review/bypass, concurrency,
role separation, hidden diagnostics, and the apply-to-deploy dependency. The
existing deployment and rollback suites remain part of CI.

The following behavior remains intentionally unverified until bootstrap:

- live GitHub OIDC assumption for the new plan/apply subjects;
- completeness of the custom read/apply API action lists against the live AWS
  provider refresh; and
- a real no-change workflow plan, reviewer approval, saved-plan apply, and
  subsequent application deployment.

No live apply should be used merely to test these controls. Establish the
prerequisites, run a real plan, review its summary, and stop before approval if
any result differs from the expected baseline.

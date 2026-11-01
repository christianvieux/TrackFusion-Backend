# Production deployment orchestration

Status: active in production. The one-time AWS, IAM/OIDC, KMS, GitHub
environment, host AWS CLI, and Parameter Store setup was completed on
2026-10-30.

Production secret reconciliation is active with the EC2 selector set to
`ssm-parameter-store`. The completed migration procedure and continuing
operating guidance are documented in
[`production-secrets-runbook.md`](production-secrets-runbook.md).

This document covers the production workflow. The configuration inventory and
secret migration record remain in
[`deployment-architecture-audit.md`](deployment-architecture-audit.md).

[Production workflow #83](https://github.com/christianvieux/trackfusionweb-api/actions/runs/41111906519)
completed successfully on 2026-10-30. It verified the protected-environment
preflight, read-only Terraform OIDC assumption, remote-backend initialization,
a no-change production plan, application deployment, and the public HTTPS
check. Because the plan had no changes, the reviewer-gated encrypted-plan apply
path was correctly skipped and remains untested with a real changed plan.

## Deployment sequence

A manual dispatch of `main` uses this fail-closed sequence:

1. Run the existing application tests, dependency audit, Docker build, and
   backend-disabled Terraform validation.
2. Verify through the GitHub API that all production environments exist, allow
   only `main`, and that infrastructure apply requires a non-bypassable,
   explicit approval from at least one configured required reviewer. In the
   solo-maintainer model, the deployment initiator is permitted to approve.
3. Enter `production-plan`, assume the read-only Terraform OIDC role, initialize
   the real S3 backend, acquire the native S3 lock, and create a saved plan with
   detailed exit codes.
4. Continue directly to application deployment when the plan is clean.
5. For a changed plan, render only actions and resource addresses, block
   destructive/replacement/bootstrap-only/unrecognized changes, and encrypt the
   binary plan client-side with an AWS KMS data key.
6. Upload only the authenticated ciphertext, encrypted data key, and nonsecret
   commit/run metadata with one-day retention.
7. Wait at the `production-infrastructure` GitHub Environment. The configured
   required reviewer must review the redacted plan summary and exact commit
   before approving; the solo maintainer may approve their own deployment.
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

The required `production-plan`, `production-infrastructure`, and `production`
environments were configured before workflow #83. The run's fail-closed
preflight verified that all three existed and allowed only `main`, and that
`production-infrastructure` had an eligible required reviewer, allowed the
solo maintainer to self-approve, and disallowed administrator bypass.

Required-reviewer protection is available for public repositories, including
GitHub Free, Pro, and Team. GitHub documents that environment protection is
enforced before a referencing job proceeds and that environment secrets remain
unavailable until approval. See
[GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

### Historical one-time GitHub setup

This setup was completed on 2026-10-30. Preserve these requirements when
reviewing or recreating the environments:

1. Add the maintainer as an eligible required reviewer with repository read
   access. This is an explicit manual authorization checkpoint, not independent
   peer review.
2. Create `production-plan`, select deployment branches, allow only the `main`
   branch, and add the nonsecret environment variable `DEVELOPER_SSH_CIDR` with
   the current administrative IPv4 `/32`. This environment must not have apply
   credentials or secret values.
3. Create `production-infrastructure`, select only `main`, configure at least one
   required reviewer, disable “prevent self-review” so the deployment initiator
   can approve, and disable administrator bypass.
4. Keep `production` restricted to only `main`. Adding a separate application
   deployment reviewer is optional and would create a second approval after
   infrastructure apply.
5. Re-read the environment API or run the workflow. The preflight must pass
   without changing `scripts/verifyProductionEnvironments.js` or weakening its
   requirements.

Do not merely create the environment names. Referencing a missing environment
can create it without protection; the preflight is what prevents that unsafe
state from reaching AWS.

## Historical one-time AWS bootstrap

The one-time administrator bootstrap was completed before workflow #83. It
established the IAM/OIDC roles, KMS keys, and exact EC2 parameter-read policy
described below. These instructions remain as a recovery/recreation record: any
future identity or key bootstrap still requires a fresh reviewed plan and
separate authorization rather than the ordinary apply role.

The bootstrap created:

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

Workflow #83 exercised the Terraform plan role with caller identity and a real
no-change plan, and exercised the application-deploy role during the successful
deployment. The apply role and encrypted changed-plan path were skipped because
the plan had no changes; they must not be described as production-tested until
a real reviewed change requires them.

## Parameter Store preparation

Terraform defines no parameters and no values. Production uses this exact
standard `SecureString` allowlist:

- `/trackfusionweb/production/api/SESSION_SECRET`
- `/trackfusionweb/production/api/JWT_SECRET`
- `/trackfusionweb/production/api/DATABASE_URL`
- `/trackfusionweb/production/api/RESEND_API_KEY`

The EC2 role can call only `ssm:GetParameters` on those four ARNs. It cannot use
`GetParameter`, history, or recursive path retrieval. GitHub plan, apply, and
application-deploy roles cannot read them.

Production uses a customer-managed symmetric KMS key for these high-value
credentials. It adds a recurring KMS key/API cost, but permits an independent
decrypt boundary: EC2 decrypt is limited to calls through SSM and to the exact
`PARAMETER_ARN` encryption contexts. The cheaper AWS-managed `alias/aws/ssm`
key was rejected because AWS grants its decrypt use to all IAM principals in
the account; parameter IAM remains a control, but the key cannot provide a
second principal-specific boundary. AWS documents this limitation in
[Restricting SecureString decryption](https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-restrict-decryption.html).

The four parameters were created with the dedicated customer-managed KMS key,
and the host-side selector is now `ssm-parameter-store`. For future recovery or
recreation, use the Terraform output `production_parameter_kms_key_arn`; do not
create placeholders or put values in Terraform variables/state. Follow the
[production secrets runbook](production-secrets-runbook.md) for operation,
rotation constraints, and rollback.

## Production origin and S3 CORS

`deploy/ec2/production-managed.env` remains the Git-managed nonsecret runtime
source of truth. The canonical production frontend is
`https://www.trackfusionweb.com`. Terraform parses its `FRONTEND_URL` and always
includes that exact HTTPS origin in S3 CORS. `var.frontend_origins` means
additional nonproduction S3 origins only. API CORS remains independently
expressed by `CORS_ALLOWED_ORIGINS`, because API requests and presigned S3
browser requests have different method/header requirements. The application
validator still requires production API CORS to include `FRONTEND_URL`.

This produces a deterministic shared canonical production origin without
pretending the API and bucket CORS policies are the same policy. Workflow #83's
no-change plan verified that no further production CORS update was required.

## Verification boundary

Fixture and contract tests cover clean and changed plans, planning failure,
destructive and bootstrap-only changes, ciphertext tampering, commit/run/stale
metadata, missing or weak GitHub environments, the solo-maintainer reviewer
setting, administrator bypass, concurrency, role separation, hidden diagnostics,
and the apply-to-deploy dependency. The existing deployment and rollback suites
remain part of CI.

Workflow #83 verified the GitHub environment preflight, Terraform plan OIDC
subject, live AWS provider refresh, no-change plan branch, application-deploy
OIDC subject, deployment, and public endpoint check. It did not create an
encrypted plan artifact, enter reviewer approval, assume the Terraform apply
role, decrypt a saved plan, or run `terraform apply` because no infrastructure
changes were present.

The real changed-plan path therefore remains intentionally unverified. Do not
create a live change merely to test it. On the next legitimate infrastructure
change, review the redacted summary and exact commit and stop before approval if
any result differs from the expected baseline.

# Deployment architecture audit

Audit date: 2026-10-29; production-state update: 2026-10-30

Scope: phase 1 architecture, configuration, and migration design, with the
completed production migration state recorded below

> Phase 2 baseline update (2026-10-29): an operator authenticated to the
> intended account, initialized the remote backend, verified existing resource
> ownership in state, and obtained a live plan of `0 to add, 1 to change, 0 to
> destroy`; the sole change was the expected S3 CORS production-origin update.
> This supersedes the remote-state uncertainty recorded below. Phase 2 controls
> are documented in
> [`deployment-orchestration.md`](deployment-orchestration.md).

> Pre-cutover Phase 3 record (2026-10-29): production Parameter Store
> reconciliation was implemented behind an explicit root-owned selector, but
> no parameter had yet been created or read and no production credential had
> changed. This status was superseded by the completion update below. See
> [`production-secrets-runbook.md`](production-secrets-runbook.md).

> Production completion update (2026-10-30): the IAM/OIDC, KMS, protected
> GitHub environments, and host AWS CLI prerequisites were completed. The four
> production credentials were migrated to KMS-encrypted SSM `SecureString`
> parameters, and the EC2 selector was set to
> `ssm-parameter-store`. [Workflow #83](https://github.com/christianvieux/trackfusionweb-api/actions/runs/41111906519)
> succeeded with a no-change Terraform plan, production deployment, and public
> HTTPS check; the application was confirmed working afterward.

This document records repository behavior that was inspected directly. It does
not assert that the checked-in Terraform matches the live AWS account, and it
does not authorize an infrastructure apply, secret read, secret rotation, or
production deployment.

## Current architecture

| Owner | Verified responsibility |
| --- | --- |
| Terraform | Declares the AWS provider guardrail, default-VPC lookup, EC2 instance and instance profile, security group rules, Elastic IP, private media bucket controls and CORS, GitHub OIDC provider and separated plan/apply/deploy roles, plan and parameter KMS keys, exact EC2 parameter-read permissions, SSM deployment document, and basic CloudWatch/SNS alarms. |
| GitHub Actions | On every push and pull request, runs application tests, dependency audit, database/API checks, a Docker build, and Terraform format/validation. A manually dispatched workflow on `main` verifies the protected environments, creates a real plan through the read-only OIDC role, conditionally gates and applies a changed saved plan, then uses the deploy role to upload a checksummed source archive, invoke the allowlisted SSM document, wait for completion, and check public HTTPS endpoints. |
| EC2 deployment scripts | Refuse to replace an unhealthy service, reconcile an allowlisted set of Git-managed nonsecret settings, validate the candidate before stopping the service, back up the release/configuration/database, install dependencies, initialize and verify the schema, configure systemd/Nginx, run health checks, and automatically restore the prior release after failure. |
| Runtime configuration | systemd reads the protected generated `/etc/trackfusion/.env`. Deployments reconcile the seven keys in `deploy/ec2/production-managed.env`, preserve instance-specific nonsecrets, and retrieve the four secret keys from Parameter Store because `/etc/trackfusion/secret-source` selects `ssm-parameter-store`. The application has no alternate secret-store loader, and Parameter Store reconciliation rejects `AWS_SECRETS_ARN`. |
| Protected credentials | GitHub receives short-lived role credentials through OIDC. EC2 receives AWS credentials through its instance profile. Application signing secrets, the database credential, and the Resend key come from four KMS-encrypted SSM `SecureString` parameters and are projected into the root-owned runtime environment. Local-only credentials belong in ignored `.env`. |
| Local Docker Compose | Runs the API, PostgreSQL, Redis, SeaweedFS S3 compatibility layer, storage initialization, and Mailpit. It binds host-facing development ports to loopback and uses local `.env` values only. |

The production Docker image is built as a CI check but is not the deployment
artifact. Production receives a source archive and installs Node and Python
dependencies on the host.

### Verified safeguards

- Privileged plan, apply, and deploy jobs run only after a manual dispatch of
  `main`, and only those jobs request `id-token: write`.
- Separate OIDC roles restrict read-only planning, reviewed apply, and
  application deployment permissions; the deploy policy is limited to the
  deployment object prefix, named SSM document and instance, and command-result
  reads.
- The EC2 metadata service requires IMDSv2.
- The S3 media bucket blocks public access, enforces bucket-owner ownership,
  and enables server-side encryption.
- Release archives are checksum-verified before extraction. Staging paths and
  release identifiers are constrained.
- Candidate configuration is validated before service interruption. The
  current service must be healthy before replacement.
- Rollback restores release, host configuration, and service definitions, but
  intentionally does not overwrite database data or uploads automatically.
- The production validator requires HTTPS origins, secure cookies, Resend
  delivery, an AWS S3 provider, and signing secrets of at least 32 characters.
- Workflow #83 verified the protected GitHub environment preflight, Terraform
  plan-role OIDC assumption, no-change remote plan, application-deploy OIDC
  assumption, deployment, and public HTTPS check.

### Unverified live assumptions

The remote backend, existing resource tracking, protected GitHub environments,
and plan/deploy OIDC subjects were verified by the completed production work.
These live assumptions remain unverified by repository evidence:
- The live instance has exactly the checked-in role/profile and no additional
  policies that create configuration drift.
- The live S3 CORS rules, instance/subnet/key settings, DNS address, alarm
  subscriptions, and host configuration match the repository.
- The Terraform changed-plan artifact, approval, apply-role OIDC, decryption,
  and saved-plan apply path works against a real production change. Workflow
  #83 had no changes, so that path was correctly skipped.

## Configuration inventory

“Conflict” means more than one current definition or alias can influence the
same setting. Platform-generated values such as `GITHUB_SHA`, `RUNNER_TEMP`,
shell internals, and `PATH` are intentionally excluded.

### Application and worker runtime

| Variable | Purpose | Secret? | Required environment | Proposed authoritative source | Validation requirements | Startup? | Conflict/current note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Selects development, test, or production behavior. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Enum: `development`, `test`, `production` | Yes | Currently host file, example, and CI |
| `HOST` | API listen address. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Loopback, wildcard, localhost, or `::` | Yes | Currently host file, example, and CI |
| `PORT` | API listen port. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Integer 1-65535 | Yes | Also used as a smoke-test fallback |
| `REQUEST_BODY_LIMIT` | Express body size limit. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Positive size with `b`, `kb`, `mb`, or `gb` suffix | Yes | Code has a fallback, validator makes it required |
| `FRONTEND_URL` | Canonical browser origin and reset-link base. | No | All API environments | Git-managed production config; local `.env`; CI workflow | HTTP(S); exact HTTPS origin in production | Yes | Currently one of seven reconciled keys |
| `CORS_ALLOWED_ORIGINS` | Comma-separated API browser origins. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Exact HTTP(S) origins; production must include `FRONTEND_URL` | Yes | Also drives local storage CORS by default |
| `DEV_URLS` | Extra development-only CORS origins. | No | Development, optional | Local `.env` | Comma-separated origins; not currently validated | No | Documented in example but outside validator |
| `SESSION_SECRET` | Signs Express sessions. | Yes | All API environments | SSM SecureString in production; local `.env`; CI fixture | Nonempty; at least 32 characters in production | Yes | Active production source is Parameter Store |
| `JWT_SECRET` | Signs login tokens and HMACs OTP-related values. | Yes | All API environments | SSM SecureString in production; local `.env`; CI fixture | Nonempty; at least 32 characters in production | Yes | Active production source is Parameter Store |
| `DATABASE_URL` | PostgreSQL connection string, including credential. | Yes | All API environments | SSM SecureString in production; local `.env`; CI fixture | `postgres:`/`postgresql:` URL; host configure step also enforces the expected local role, host, port, and database | Yes | Active production source is Parameter Store; local Compose assembles it from `POSTGRES_PASSWORD` |
| `REDIS_URL` | Session store and Bull queue connection. | No, with current unauthenticated local topology | All API environments | Git-managed production config; local `.env`; CI workflow | `redis:` or `rediss:` URL | Yes | Treat as a secret if credentials are ever added |
| `PYTHON_EXECUTABLE` | Python binary used by audio workers. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Nonempty only; path/executable is not validated | Yes | Queue code also has a fallback |
| `STORAGE_PROVIDER` | Selects AWS S3 or local S3-compatible storage. | No | All API environments | Git-managed production config; local `.env`; CI workflow | `aws-s3` or `s3-compatible`; production requires `aws-s3` | Yes | Currently one of seven reconciled keys |
| `STORAGE_REGION` | Preferred storage region. | No | All when `AWS_REGION` is absent | Git-managed production config; local `.env` | Nonempty only | Conditional | Conflicts with compatibility alias `AWS_REGION` |
| `STORAGE_BUCKET` | Preferred storage bucket name. | No | All when `AWS_S3_BUCKET` is absent | Git-managed production config; local `.env` | Nonempty only | Conditional | Conflicts with compatibility alias `AWS_S3_BUCKET` |
| `AWS_REGION` | AWS SDK region and storage-region compatibility alias. | No | Production and CI AWS usage | Git-managed production/deployment config; CI workflow | Nonempty only; Terraform independently pins its region | Conditional | Duplicates Terraform/workflow values and `STORAGE_REGION` |
| `AWS_S3_BUCKET` | Storage-bucket compatibility alias and S3 verification input. | No | Current production/CI when `STORAGE_BUCKET` is absent | Git-managed production config; CI workflow | Nonempty only | Conditional | Duplicates `STORAGE_BUCKET`; workflow has a separate deployment-bucket setting |
| `STORAGE_ENDPOINT` | Internal S3-compatible endpoint. | No | Local S3-compatible storage only | Local `.env`/Compose | HTTP(S) URL | Conditional | Compose overrides direct-node example |
| `STORAGE_PUBLIC_ENDPOINT` | Browser-reachable S3-compatible endpoint used to sign local URLs. | No | Local S3-compatible storage only | Local `.env`/Compose | HTTP(S) URL | Conditional | Compose derives it from a host port |
| `STORAGE_ACCESS_KEY_ID` | Local S3-compatible access identifier. | Yes, local credential | Local S3-compatible storage only | Local `.env` | Nonempty | Conditional | Compose derives it from `LOCAL_STORAGE_ACCESS_KEY_ID` |
| `STORAGE_SECRET_ACCESS_KEY` | Local S3-compatible secret credential. | Yes | Local S3-compatible storage only | Local `.env` | Nonempty | Conditional | Compose derives it from `LOCAL_STORAGE_SECRET_ACCESS_KEY` |
| `STORAGE_CORS_ALLOWED_ORIGINS` | CORS rules created for the local storage bucket. | No | Local storage initialization, optional | Local `.env`/Compose | Comma-separated origins; not validator-checked | No | Defaults from API CORS origins in Compose |
| `AUDIO_MAX_LENGTH` | Maximum audio duration in seconds. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Positive integer | Yes | Some consumers also default to 900 |
| `AUDIO_MAX_FILE_SIZE` | Maximum audio upload size in MB. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Positive integer | Yes | Some consumers also default to 300 |
| `IMAGE_MAX_FILE_SIZE` | Maximum image upload size in MB. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Positive integer | Yes | Some consumers also default to 50 |
| `ALLOWED_AUDIO_TYPES` | Comma-separated accepted audio MIME types. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Required but entries are not individually validated | Yes | CI and local lists differ |
| `ALLOWED_IMAGE_TYPES` | Comma-separated accepted image MIME types. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Required but entries are not individually validated | Yes | CI and local lists differ |
| `COOKIE_SECURE` | Requires secure authentication cookies. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Boolean; must be true in production | Yes | Currently one of seven reconciled keys |
| `COOKIE_SAME_SITE` | Cookie SameSite mode. | No | All API environments | Git-managed production config; local `.env`; CI workflow | `lax`, `strict`, or `none` | Yes | `none` forces secure cookies in code |
| `COOKIE_DOMAIN` | Optional explicit cookie domain. | No | Nonproduction only, optional | Local `.env`; deliberately absent in production | Must be unset in production | No | Example comments it out |
| `EMAIL_PROVIDER` | Selects Resend, SMTP, or disabled delivery. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Enum; production requires `resend` | Yes | Currently one of seven reconciled keys |
| `EMAIL_DELIVERY_ENABLED` | Enables transactional delivery. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Boolean; must be true in production | Yes | Currently one of seven reconciled keys |
| `EMAIL_VALIDATE_MX` | Enables DNS MX validation. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Boolean | Yes | Required by validator, not managed by production reconciliation |
| `EMAIL_ALLOWED_DOMAINS` | Optional registration-domain allowlist. | No | Any, optional | Git-managed production config if used; local `.env` | Comma-separated domain names; not startup-validated | No | Absence allows any otherwise valid domain |
| `RESEND_API_KEY` | Authenticates production transactional email. | Yes | Production | SSM SecureString in production | Nonempty when Resend delivery is enabled | Conditional | Active production source is Parameter Store |
| `SMTP_HOST` | SMTP server hostname. | No | SMTP delivery only | Local `.env` | Nonempty when SMTP is enabled | Conditional | Production validator disallows SMTP |
| `SMTP_PORT` | SMTP server port. | No | SMTP delivery only | Local `.env` | Integer 1-65535 | Conditional | Production validator disallows SMTP |
| `SMTP_SECURE` | Selects implicit SMTP TLS. | No | SMTP delivery only | Local `.env` | Boolean | Conditional | Production validator disallows SMTP |
| `SMTP_USERNAME` | Optional SMTP authentication identity. | Sensitive identifier | SMTP delivery only, optional | Local `.env` | Not currently validated | No | Password pairing is not validated |
| `SMTP_PASSWORD` | Optional SMTP authentication credential. | Yes | SMTP delivery only, conditional on username | Local `.env` | Not currently validated | No | Production validator disallows SMTP |
| `EXPOSE_OTP_IN_DEVELOPMENT` | Allows OTPs in development responses when delivery is disabled. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Boolean; cannot be true in production | Yes | Required even when irrelevant to production |
| `EXPOSE_RESET_TOKEN_IN_DEVELOPMENT` | Allows reset tokens in development responses when delivery is disabled. | No | All API environments | Git-managed production config; local `.env`; CI workflow | Boolean; cannot be true in production | Yes | Required even when irrelevant to production |
| `DELAY_TIME` | Delay used by one track route. | No | Any, optional | Git-managed production config if retained; local `.env` | Positive integer should be added; currently unvalidated | No | Undocumented; code default and comment disagree |
| `YT_DLP_PROXY_URL` | Optional proxy used by the Python URL audio downloader. | Potentially, if URL contains credentials | Any, optional | SSM SecureString in production only if used; otherwise absent; local `.env` | Proxy URL validation is not currently present | No | Not in example or startup validator |
| `AWS_SECRETS_ARN` | Legacy configuration marker rejected by production reconciliation. | No | Unsupported | Must be absent | Reconciliation fails closed if present | No | Application loader removed; rejection retained to prevent a competing source |

### Local, operational, and CI variables

| Variable | Purpose | Secret? | Required environment | Proposed authoritative source | Validation requirements | Startup? | Conflict/current note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | Local Compose database password and API URL input. | Yes | Local Compose | Local ignored `.env` | Compose requires nonempty | Compose start | Separate from production `DATABASE_URL` credential |
| `LOCAL_API_PORT` | Loopback host port for the API. | No | Local Compose, optional | Local `.env` | Valid free port; not explicitly validated | No | Also used by local smoke scripts |
| `LOCAL_STORAGE_PORT` | Loopback host port for S3-compatible storage. | No | Local Compose, optional | Local `.env` | Valid free port; not explicitly validated | No | Feeds the public storage endpoint |
| `LOCAL_STORAGE_REGION` | Local storage region label. | No | Local Compose, optional | Local `.env` | Nonempty; not explicitly validated | No | Mapped to both storage and AWS compatibility names |
| `LOCAL_STORAGE_BUCKET` | Local storage bucket name. | No | Local Compose, optional | Local `.env` | S3-compatible name; not explicitly validated | No | Mapped to both storage and AWS compatibility names |
| `LOCAL_STORAGE_ACCESS_KEY_ID` | SeaweedFS local access identifier. | Yes, local credential | Local Compose, optional default | Local `.env` | Nonempty; not explicitly validated | No | Mapped to storage and AWS SDK names |
| `LOCAL_STORAGE_SECRET_ACCESS_KEY` | SeaweedFS local secret credential. | Yes | Local Compose, optional default | Local `.env` | Nonempty; not explicitly validated | No | Mapped to storage and AWS SDK names |
| `LOCAL_MAILPIT_SMTP_PORT` | Mailpit SMTP host port. | No | Local Compose, optional | Local `.env` | Valid free port; not explicitly validated | No | Compose-internal port remains fixed |
| `LOCAL_MAILPIT_UI_PORT` | Mailpit UI host port and script fallback. | No | Local Compose, optional | Local `.env` | Valid free port; not explicitly validated | No | Also used by registration verification |
| `LOCAL_MAILPIT_MAX_MESSAGES` | Mailpit retention limit. | No | Local Compose, optional | Local `.env` | Positive integer should be enforced; currently not | No | None |
| `API_BASE_URL` | Base URL for smoke/registration scripts and production workflow checks. | No | Tooling/CI, optional locally | CI workflow or operator shell/local `.env` | HTTP(S) URL should be enforced; currently not | No | Same name has local and public uses |
| `MAILPIT_BASE_URL` | Mailpit URL for local registration verification. | No | Local tooling, optional | Local `.env` | HTTP(S) URL should be enforced; currently not | No | Falls back to local UI port |
| `NODE_VERSION` | Node release installed by host bootstrap. | No | Host bootstrap, optional | Git-managed bootstrap default or explicit operator input | Exact supported version should be pinned | No | CI and Docker pin versions separately |
| `AWS_ACCOUNT_ID` | Builds the deploy-role ARN in GitHub Actions. | No | Production workflow | GitHub environment/repository variable or generated deployment config | Twelve-digit account ID and allowed-account check | No | Duplicates Terraform default and workflow literal |
| `INSTANCE_ID` | SSM deployment target in GitHub Actions. | No | Production workflow | Terraform output promoted to protected GitHub configuration | EC2 instance ID format | No | Currently hard-coded separately from Terraform state |
| `DEPLOYMENT_BUCKET` | Release archive destination in GitHub Actions. | No | Production workflow | Terraform output promoted to protected GitHub configuration | S3 bucket name | No | Currently shares the media bucket |
| `AWS_ACCESS_KEY_ID` | Standard AWS SDK static credential input. | Yes | None for production; blanked in Compose | Do not set in production; local shell only if a developer explicitly needs AWS | AWS SDK-owned | No | Production must use roles/OIDC |
| `AWS_SECRET_ACCESS_KEY` | Standard AWS SDK static secret input. | Yes | None for production; blanked in Compose | Do not set in production; local shell only if explicitly needed | AWS SDK-owned | No | Production must use roles/OIDC |
| `AWS_SESSION_TOKEN` | Standard AWS SDK temporary-session token. | Yes | None for production; blanked in Compose | Local shell credential provider only | AWS SDK-owned | No | Production must use roles/OIDC |
| `AWS_PROFILE` | Selects a local AWS credential profile. | No | Local tooling only | Operator shell; Compose deliberately clears it | AWS SDK-owned | No | Must not become a production dependency |

### Terraform inputs

Terraform declares nonsecret inputs for account/region, existing bucket and EC2
placement, API domain, restricted SSH CIDR, frontend CORS origins, immutable
GitHub identity claims/environment, and an optional monitoring email. Only
`developer_ssh_cidr` is required without a default. None should carry a secret.
The alert email is personal data and will be recorded in state if enabled.

## Completed production secret migration design

### Authority and namespace

Production uses standard-tier SSM Parameter Store `SecureString` parameters
under this dedicated namespace:

| Parameter | Runtime variable | Required |
| --- | --- | --- |
| `/trackfusionweb/production/api/SESSION_SECRET` | `SESSION_SECRET` | Yes |
| `/trackfusionweb/production/api/JWT_SECRET` | `JWT_SECRET` | Yes |
| `/trackfusionweb/production/api/DATABASE_URL` | `DATABASE_URL` | Yes |
| `/trackfusionweb/production/api/RESEND_API_KEY` | `RESEND_API_KEY` | Yes |

This is the complete initial retrieval allowlist. Do not use a path-recursive
fetch, accept arbitrary returned keys, or add optional values without an
explicit inventory update. Phase 2 selected a customer-managed symmetric KMS
key for these standard SecureString parameters so EC2 decryption can be isolated
by principal, SSM service, and exact parameter encryption context. The cost and
AWS-managed-key tradeoff are recorded in
[`deployment-orchestration.md`](deployment-orchestration.md#parameter-store-preparation).

Terraform should manage the EC2 retrieval policy, not secret values. Declaring
secret values through `aws_ssm_parameter`, even with sensitive variables,
would place plaintext values in Terraform state and is prohibited by this
design. The GitHub deploy role does not need permission to read parameters.

The EC2 role receives only `ssm:GetParameters` on the four exact parameter ARNs
and `kms:Decrypt` on the dedicated key, constrained to SSM and those exact
`PARAMETER_ARN` encryption contexts. It does not receive
`ssm:GetParametersByPath`, parameter write/delete actions, broad Secrets Manager
access, or static AWS credentials.

### Completed migration and application-loader retirement

1. The remote-state/import audit and administrator bootstrap established the
   reviewed IAM/OIDC roles, KMS keys, and exact-ARN EC2 read policy.
2. An authorized operator migrated the four approved values through a protected
   input path into standard `SecureString` parameters; values were not placed in
   Terraform state, CI, tickets, or this documentation.
3. The root-owned reconciler was deployed to request the exact allowlist with
   decryption, reject missing/duplicate/unexpected/unsafe results without
   printing values, and build a mode-`0600` candidate runtime environment.
4. The selector was set to `ssm-parameter-store`, and workflow #83 validated the
   candidate before service interruption, installed it atomically, completed
   deployment health checks, and left the application working.
5. The inactive `AWS_SECRETS_ARN` application loader and SDK dependency were
   retired after the rollback window. Reconciliation still rejects the legacy
   marker, and obsolete recovery artifacts remain subject to separately
   authorized retention cleanup.

The detailed protected input and cutover procedures remain in
[`production-secrets-runbook.md`](production-secrets-runbook.md) as historical
and recovery guidance. Secret values must never be recorded there or here.

### Recovery and rollback

- Current production keeps `ssm-parameter-store` as the explicit secret source;
  `/etc/trackfusion/.env` is the generated runtime projection, not the secret
  authority.
- A failed candidate fetch or validation must happen before service stop and
  leave the current process and file untouched.
- The pre-cutover backup retains the prior service unit, release, and protected
  host file. Rollback selects that unit/file as a set; it must not copy SSM
  values back to disk or rotate any credential.
- If the SSM-backed release starts but fails health checks, use the existing
  automatic release rollback. Database and upload restore remain separate,
  explicit decisions.
- Do not delete or change a parameter during rollback. Parameter rollback is
  unnecessary because migration preserves the existing values.
- After the old recovery artifact expires, recovery means fixing access or
  restoring the same parameter version, not introducing a newly generated
  JWT, session, database, or provider credential.

## Terraform readiness and risk

The configuration uses an encrypted S3 backend and native S3 lockfile. An
operator verified the remote state and that existing resources are tracked.
The backend bucket itself is not managed here, so its versioning, retention,
access logging, and recovery controls still require an operational runbook.

High-risk plan areas before any apply are:

- EC2 replacement triggers such as subnet, key, or other immutable placement
  changes (the instance and bucket have `prevent_destroy`, which will block but
  not make an unsafe plan acceptable);
- a new Elastic IP or association changing the address expected by external
  DNS;
- state removal or import mistakes that could make Terraform propose a second
  account-level GitHub OIDC provider or fixed-name IAM/SSM object;
- S3 CORS differences affecting browser uploads;
- the deliberate EC2 AMI `ignore_changes`, which hides image drift and defers
  upgrades;
- use of one bucket for media and deployment archives while the runtime role
  has object access across the entire bucket;
- a default-VPC/subnet assumption that has not been compared with live state.

Local formatting and validation passed during Phase 1. At the start of Phase 2,
an authenticated operator initialized the remote backend and obtained a live
plan of `0 to add, 1 to change, 0 to destroy`; only the expected S3 CORS origin
update remained. After the authorized modernization, workflow #83 obtained a
verified no-change production plan on 2026-10-30 and continued to a successful
application deployment. Because it was a no-change plan, the real changed-plan
apply path remains untested.

## Completed setup and remaining work

The GitHub environments, IAM/OIDC and KMS bootstrap, host AWS CLI, four
SecureStrings, exact EC2 read policy, selector activation, and production
deployment are complete. Remaining work includes:

- exercising the encrypted, reviewer-gated Terraform apply path only when a
  legitimate changed production plan exists;
- designing coordinated credential rotation, especially for `DATABASE_URL`;
- improving off-host backup, retention, restore testing, and recovery
  objectives; and
- addressing the other open items in
  [`engineering-backlog.md`](engineering-backlog.md).

# TrackFusionWeb Backend Modernization Handoff

Last reconstructed: October 24, 2026

This document separates repository evidence from operational claims. Re-check the working tree and relevant services before relying on it; do not treat it as a substitute for tests or a Terraform plan.

## Guardrails

- Do not push, merge, deploy, or change live AWS infrastructure without the user's explicit approval.
- Preserve the canonical `TrackFusionWeb-*` AWS naming pattern.
- Do not commit `.env`, `terraform.tfvars`, Terraform state, AWS credentials, private keys, database passwords, or Mailgun credentials.
- Review the large existing working tree before editing. Nearly all modernization changes are currently uncommitted and belong to the user.
- Prefer small, verifiable steps and explain decisions using this codebase.

## Git state

- Repository: `TrackFusion-Backend`
- Branch: `May_2026`
- `HEAD`: `1d065db3e06e719995f34f37d6d3bf9d5f688163`
- Latest commit: `fix: update API routes and health check endpoints to remove '/api' prefix` (May 10, 2026)
- The modernization work is not represented by later commits. It exists as a large dirty working tree: dozens of modified tracked files plus new Docker, deployment, Terraform, CI, documentation, scripts, and tests.
- No commit, push, merge, or GitHub-hosted workflow run was performed during the modernization session.

Recent commits before the working-tree modernization:

1. `1d065db` — route and health-prefix update
2. `3b59020` — cookie centralization and CORS changes
3. `7b1b5e7` — removed the old App Runner workflow
4. `57d166d` — earlier dynamic CORS handling
5. `3821854` — Mailgun integration and SendGrid removal

## Architecture verified from code

The API is a single Node/Express process with in-process Bull workers:

```text
Browser/client
    |
    v
Express routes and middleware
    |-- PostgreSQL: users, tracks, OTPs, reset tokens, metadata
    |-- Redis: express-session storage and Bull queues
    |-- S3: private upload/finalization/playback objects through AWS SDK v3
    `-- Python + FFmpeg: audio download, conversion, and analysis
```

`index.js` deliberately validates configuration and connects to PostgreSQL and Redis before binding the HTTP port. This is fail-fast behavior: an unhealthy dependency prevents a misleading "running" API. The same file handles `SIGINT`/`SIGTERM`, closes Bull queues, disconnects Redis, and closes the PostgreSQL pool.

AWS clients use the SDK's default credential provider chain. Local development can use temporary AWS CLI credentials; EC2 can use its instance role. The code does not require embedded access keys.

Production sessions use Redis through `connect-redis`; this avoids process-memory sessions disappearing on restart and permits future multi-process or multi-host operation.

## Phase status

### Phase 1 — audit and local stabilization

Implemented in the working tree:

- centralized environment initialization and validation in `utils/loadEnv.js`;
- required `HOST`, dependency URLs, cookie/email flags, upload limits, and production secret validation;
- PostgreSQL and Redis startup verification;
- Redis-backed sessions and Bull queues;
- graceful process shutdown;
- rerunnable schema initialization and schema verification scripts;
- authentication/authorization, ownership, rate-limit, and information-disclosure fixes;
- AWS SDK credential-chain usage;
- Python/audio dependency and error-handling updates;
- unit tests for environment, email, and password helpers.

Verified on October 24, 2026:

- 3 Jest suites / 13 tests pass;
- Python scripts compile;
- deployment shell scripts and key Node entry scripts pass syntax checks;
- `git diff --check` passes.

Not re-verified in the current sandbox:

- local PostgreSQL/Redis integration and live API smoke. Local sockets, netlink, and systemd are denied by the sandbox (`EPERM`).

### Phase 2 — initial EC2 deployment

Repository evidence exists for:

- `deploy/ec2/bootstrap-host.sh`;
- `deploy/ec2/configure-app.sh`;
- systemd unit and Nginx reverse-proxy configuration;
- private S3 access verification script;
- checksum-verified SSM deployment document in Terraform.

The README and previous-session notes report a working EC2 deployment with PostgreSQL, Redis, Nginx, S3 role access, and public smoke tests. This was not queried or changed during this reconstruction because live AWS operations require explicit approval.

### Phase 3 — documentation

The root README was rewritten around the actual architecture, environment contract, local setup, AWS authentication, deployment, Docker, Terraform, CI/CD, monitoring, troubleshooting, and security.

This handoff file was missing and was recreated from repository evidence on October 24, 2026.

### Phase 4 — Docker

Implemented:

- multi-stage production `Dockerfile`;
- Node 24 dependency stage;
- Python 3.12 virtual environment stage;
- Debian Bookworm runtime with FFmpeg, curl, and `dumb-init`;
- unprivileged UID/GID 10001 runtime user;
- API health check;
- Compose services for PostgreSQL 16, Redis 7, and the API;
- health-gated startup and rerunnable schema initialization;
- API host port bound to `127.0.0.1:8081` only;
- secret/generated-file exclusions in `.dockerignore`.

Static checks completed:

- `compose.yaml` parses as YAML;
- container environment overrides match `utils/loadEnv.js`;
- native Node and Python stages use compatible Debian Bookworm bases;
- active file-processing paths use `/tmp` and S3, both compatible with the non-root runtime.

Functional verification completed on October 24, 2026:

- all 23 Docker build steps completed successfully;
- PostgreSQL 16 and Redis 7 reached healthy state;
- the API initialized its database schema, connected to PostgreSQL and Redis, and reached healthy state;
- smoke checks passed for health, session, public tracks, and track-attribute enums;
- `docker compose down` removed the containers/network and preserved the named database/Redis volumes.

The successful build also revealed an 833 MB context caused by the local Terraform provider under `infrastructure/terraform/.terraform`. The entire `infrastructure` directory is now excluded from the API build context because Terraform is not an API runtime dependency. Rebuild the local image once before considering it publishable.

Still incomplete:

- Docker access currently requires `sudo` because the user's login session does not have Docker socket access;
- rebuild after the `.dockerignore` correction and confirm the build context/image no longer contains Terraform provider files;
- the CI Docker build cannot run until the workflow is committed and pushed.

Current restart point: run a clean local rebuild after the `.dockerignore` correction, inspect its size/content, and rerun the smoke test if the image changed unexpectedly. The full Compose topology has already passed once.

### Phase 5 — Terraform

Implemented as local configuration under `infrastructure/terraform`:

- S3 bucket controls and CORS;
- canonical API IAM policy, role, attachment, and instance profile;
- security group and rules;
- EC2 instance representation with `prevent_destroy`;
- GitHub OIDC deployment role/policy;
- SSM deployment document;
- EC2 CPU and status-check alarms;
- encrypted S3 remote backend with native lockfile support;
- provider dependency lock file and one-time import documentation.

Local formatting is clean. The README reports that existing resources were imported and the final live plan converged to no changes. Do not rerun imports or plan/apply against AWS without explicit approval and current credentials.

### Phase 6 — CI/CD and final improvements

Implemented locally:

- `.github/workflows/ci-cd.yml` with tests, npm production audit, Python checks, PostgreSQL/Redis integration, Docker build, Terraform validation, and conditional production deployment;
- immutable SHA pins for third-party GitHub Actions;
- GitHub OIDC rather than long-lived AWS keys;
- checksum-verified S3 artifact deployment through SSM;
- `.github/dependabot.yml` for npm, pip, Docker, Terraform, and Actions.

Still incomplete:

- workflow and Dependabot files are untracked and have never run on GitHub;
- the GitHub `production` environment and its protection rules need owner review;
- no commit/push should occur without the user's direction;
- API domain/HTTPS is not configured;
- production Mailgun credentials/domain are not configured;
- optional monitoring notification email is not configured.

## Current verification commands

Safe local checks:

```bash
npm test -- --runInBand
python3 -m compileall -q python
bash -n deploy/ec2/bootstrap-host.sh deploy/ec2/configure-app.sh
git diff --check
terraform fmt -check -recursive infrastructure/terraform
```

Docker verification once an engine is available:

```bash
docker compose config --quiet
docker compose build --pull api
docker compose up -d
docker compose ps
npm run smoke
docker compose logs --no-color --tail=100 api
docker compose down
```

Do not add `--volumes` to `docker compose down` unless deleting local PostgreSQL and Redis data is intentional.

## Known cleanup and follow-up items

- `queue/imageQueue.js` appears unused: repository search finds no imports. It writes to `public/uploads/profile-pictures`, unlike the active S3-backed profile-picture queue. Confirm behavior with the frontend/API flow before deleting it.
- The real `.env` and `infrastructure/terraform/terraform.tfvars` are intentionally ignored. Never print or commit them.
- A local database password was previously pasted into conversation history. Rotate it before treating the local environment as clean.
- Routine AWS administration should not use the account root identity.
- The EC2 public IPv4 address is documented as ephemeral; HTTPS needs a stable address and user-owned API hostname.

## Next action

Continue at the final Phase 4 packaging check. The full build/Compose/smoke path passed, but the first image included the local Terraform provider because `infrastructure` was not ignored. Rebuild with the corrected `.dockerignore`, verify the much smaller context/image, and do not publish the original local image. Docker access currently requires `sudo` unless the user intentionally configures Docker-group membership. Do not push the CI workflow without the user's approval.

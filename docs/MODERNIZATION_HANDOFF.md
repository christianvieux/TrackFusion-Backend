# TrackFusionWeb Backend Modernization Handoff

Last updated: October 25, 2026

This document separates repository evidence from operational claims. Re-check the working tree and relevant services before relying on it; do not treat it as a substitute for tests or a Terraform plan.

## Guardrails

- Do not push, merge, deploy, or change live AWS infrastructure without the user's explicit approval.
- Preserve the canonical `TrackFusionWeb-*` AWS naming pattern.
- Do not commit `.env`, `terraform.tfvars`, Terraform state, AWS credentials, private keys, database passwords, or Mailgun credentials.
- Review the working tree before editing and preserve unrelated user changes.
- Prefer small, verifiable steps and explain decisions using this codebase.

## Git state

- Repository: `trackfusionweb-api`
- Phase A branch: `feat/production-https`
- Base: `main` at `341fdad` (`Merge pull request #14 from christianvieux/fix/production-deployment-hardening`)
- The modernization, CI/CD, and guarded backup/rollback work is committed on `main`.
- The HTTPS branch is for repository implementation only. It must not be pushed, merged, deployed, or applied to AWS without the owner's next approval.

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

Read-only AWS and host inspection on October 25, 2026 verified:

- instance `i-003f490e99fd1054d` is running Ubuntu 24.04 as a managed SSM instance;
- the instance uses `TrackFusionWeb-API_Role`, `t3.small`, and public IP `3.91.170.191`;
- no Elastic IP is allocated in the account;
- the attached security group exposes only public 80/443 and developer-restricted 22; 8081 listens on loopback;
- Nginx and `trackfusionweb-api` are active, and the installed HTTP-only Nginx file matches the tracked file;
- Certbot is not installed, no certificate is present, and `certbot.timer` does not exist;
- `api.trackfusionweb.com` currently resolves to the temporary public IP and HTTP health returns `200`.

No live resource, host configuration, DNS record, or certificate was changed by that audit.

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

The existing resources remain imported. The HTTPS branch intentionally adds an Elastic IP and association so the IONOS A record survives EC2 stop/start. A read-only, unlocked plan on October 25, 2026 reported exactly `2 to add, 0 to change, 0 to destroy`: the Elastic IP and its association to the existing instance. Nothing was applied. Do not rerun imports or apply without explicit approval and current credentials.

### Phase 6 — CI/CD and final improvements

Implemented locally:

- `.github/workflows/ci-cd.yml` with tests, npm production audit, Python checks, PostgreSQL/Redis integration, Docker build, Terraform validation, and conditional production deployment;
- immutable SHA pins for third-party GitHub Actions;
- GitHub OIDC rather than long-lived AWS keys;
- checksum-verified S3 artifact deployment through SSM;
- `.github/dependabot.yml` for npm, pip, Docker, Terraform, and Actions.

Current HTTPS work on `feat/production-https` adds tracked bootstrap/TLS Nginx configuration, one-time Certbot activation, automatic renewal integration, HTTPS-aware deployment/rollback checks, public HTTPS workflow smoke checks, and weekly certificate-expiry monitoring. Production activation remains incomplete and requires the separately approved rollout in `docs/PRODUCTION_HTTPS_ROLLOUT.md`.

Other incomplete external work:

- review the GitHub `production` environment and its protection rules;
- configure production Mailgun credentials/domain if email flows should be enabled;
- configure and confirm the optional monitoring notification email if desired.

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
- The current EC2 public IPv4 address remains ephemeral until the reviewed Elastic IP plan is applied; the API hostname already exists at IONOS.

## Next action

Complete local Phase A validation, review and commit `feat/production-https`, then stop. Phase B requires fresh approval before Terraform apply, IONOS DNS changes, certificate issuance, host configuration, branch push/merge, or production workflow execution. Follow `docs/PRODUCTION_HTTPS_ROLLOUT.md` in order after that approval.

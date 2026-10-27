# TrackFusionWeb API

TrackFusionWeb is a music-sharing application for publishing, discovering, and organizing audio tracks. This repository contains the backend API that manages accounts, track metadata, privacy rules, favorites, media storage, and audio analysis.

🌐 **Live application:** [www.trackfusionweb.com](https://www.trackfusionweb.com)

The production API is available at [api.trackfusionweb.com](https://api.trackfusionweb.com). Its health endpoint is `GET /health`.

## Frontend application

The user-facing frontend for TrackFusionWeb is maintained in a separate repository: **[trackfusionweb-app](https://github.com/christianvieux/trackfusionweb-app)**.

The frontend connects to this backend API for authentication, track discovery and management, favorites, uploads, and playback. Visit [www.trackfusionweb.com](https://www.trackfusionweb.com) to access the application.

## Key features

- Account registration with one-time-code validation, login/logout, session checks, password changes, and password-reset workflows.
- Public and private track catalogs with creator ownership checks, profile data, favorites, and track editing or deletion.
- Direct browser uploads to private S3-compatible storage through time-limited presigned URLs.
- Signed playback URLs that keep media private while allowing controlled access.
- Redis-backed background jobs for upload processing and BPM/key analysis.
- Audio and image validation before media records are finalized.
- Health, schema verification, and smoke-test commands for local and production checks.

## Technology

| Component | Purpose |
| --- | --- |
| Node.js 22+ and Express 4 | HTTP API, validation, authentication, and application logic. The production image pins Node.js 24.16.0. |
| PostgreSQL 16 | Users, tracks, favorites, verification codes, reset tokens, and related metadata. |
| Redis and Bull | Server-side sessions and asynchronous media-processing jobs. |
| Python 3.12, librosa, NumPy, and FFmpeg | BPM/key analysis and supporting audio processing. |
| AWS S3, SeaweedFS, and AWS SDK v3 | Private production and local media storage through one S3-compatible implementation. |
| Resend and Mailpit | Production transactional email and local-only SMTP capture. |
| Nginx and systemd | TLS termination, reverse proxying, and API process supervision on EC2. |
| Terraform and GitHub Actions | Reproducible AWS infrastructure and tested, keyless deployments. |
| Jest and Docker Compose | Unit testing and a repeatable local service stack. |

Transactional verification, password-reset, and password-change emails use an
explicit provider: Resend in production and Mailpit SMTP capture locally. Codes
and reset tokens are never returned by the development API.

## Architecture

```text
Browser / frontend
   |  HTTPS, JSON, secure cookies
   v
Nginx :443
   |
   v
Express API :8081
   |-- PostgreSQL       users, tracks, favorites, tokens
   |-- Redis + Bull     sessions, job state, background queues
   |      `-- Node/Python workers for media validation and analysis
   `-- S3 storage       private audio and image objects

Browser <---- time-limited presigned upload/playback URLs ----> S3-compatible storage
```

Nginx is the only public application entry point in production. It redirects HTTP to HTTPS and forwards requests to Express on the EC2 loopback interface. PostgreSQL, Redis, and Express are not exposed publicly.

For uploads, the API issues a user-scoped S3 URL and the browser transfers the file directly to S3. The client then submits metadata to the API. A Bull worker downloads and validates the file, extracts audio metadata, moves it to its final S3 key, and stores the database record. Job-status endpoints only return jobs owned by the authenticated user.

For playback, the API checks the track's privacy and ownership before returning a short-lived S3 URL. Public catalog records therefore do not require the bucket itself to be public.

## Getting started

### Docker Compose: supported local workflow

Prerequisites are Docker Engine with Compose v2 and Node.js 22+ for running the
host-side tests. The stack contains the API, PostgreSQL, Redis, SeaweedFS object
storage, and Mailpit email capture. It uses dedicated local credentials and
does not use AWS SSO, IAM keys, an AWS account, Resend, or remote infrastructure.

Create `.env` only if it does not already exist, then replace the password and
secret placeholders. Never overwrite an existing local environment file.

```bash
test -e .env || cp .env.example .env
chmod 600 .env
npm ci
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8081/health
```

The API is at `http://127.0.0.1:8081`, the browser-facing S3 endpoint is at
`http://127.0.0.1:9000`, and the captured-email inbox is at
`http://127.0.0.1:8025`. PostgreSQL and Redis remain private to the Compose
network, avoiding conflicts with native services. Named volumes persist database,
queue, object, and inbox data.

The `storage-init` service safely creates the development bucket, configures CORS
for `STORAGE_CORS_ALLOWED_ORIGINS`, and verifies write/delete access before the
API starts. Internal SDK requests use `http://storage:8333`; signed browser URLs
are generated directly for `http://127.0.0.1:9000`. Signed URLs are never rewritten.

Run the focused checks:

```bash
npm test -- --runInBand
docker compose exec -T api node scripts/verifyDatabase.js
API_BASE_URL=http://127.0.0.1:8081 npm run smoke
npm run storage:verify
npm run registration:verify
```

`registration:verify` creates unique local-only test accounts and retained media.
It verifies Mailpit OTP/reset delivery, grant consumption, concurrency, session,
login/logout, password reset, profile upload, WAV processing, and signed media
retrieval. It never prints OTPs, reset tokens, credentials, or signed URLs.

Stop services without deleting data:

```bash
docker compose down
```

Do not add `-v` unless all local database, inbox, and object data is intentionally
being discarded.

### Browser workflow

For the sibling frontend checkout, create an ignored `.env.local` containing:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8081
NEXT_PUBLIC_SITE_URL=http://localhost:3001
```

Start its existing development server and open `http://localhost:3001`. Use any
syntactically valid local test address; Mailpit captures it without external
delivery. Read the verification code or reset link at `http://127.0.0.1:8025`.

The current frontend contract remains supported: `/users/check-email`,
`/otp/generate`, `/otp/verify`, `/users/register`, and `/auth/login` still exist,
and cookie credentials carry the verified registration grant between verify and
register. Recommended frontend cleanup is to retain the `registrationGrant`
returned by `/otp/verify`, send it as `registration_grant`, stop sending
`otp_code` to `/users/register`, and skip the redundant login because successful
registration now establishes the session. Signed profile-picture URLs must not
have cache-busting query parameters appended; request a fresh user response
instead when the picture changes.

### Run the API directly

Install Node.js 22+, Python 3.12, FFmpeg, native PostgreSQL, and native Redis.
Start SeaweedFS and Mailpit from Compose (`docker compose up -d storage
storage-init mailpit`), configure the direct-host values from `.env.example`,
then run:

```bash
npm ci
python3 -m venv venv
venv/bin/pip install -r requirements.txt
npm run db:init
npm run db:verify
npm run dev
```

Do not point `DATABASE_URL` or `REDIS_URL` at production during local testing.
The local storage provider fails explicitly when unavailable and never falls
back to AWS.

## API overview

All endpoints return JSON unless they return a file download. Protected routes read the JWT from an HTTP-only cookie, and browser clients must include credentials with cross-origin requests.

| Area | Representative endpoints |
| --- | --- |
| Health | `GET /health` |
| Authentication | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, password reset/change routes |
| Registration and profiles | `POST /users/register`, `POST /users/check-email`, `GET /users/info/:userId`, OTP routes under `/otp` |
| Tracks | `GET /tracks/public`, `GET /tracks/user`, `GET /tracks/:id`, `PUT /tracks/:id`, `DELETE /tracks/:id` |
| Favorites | `GET /tracks/favorites`, `POST /tracks/favorites`, `DELETE /tracks/favorites` |
| Media | `POST /aws/presigned-url`, track/profile processing and status routes under `/upload` |
| Audio analysis | `POST /audio/analyze`, `GET /audio/analysis-status/:jobId` |
| Public profiles | Public user tracks and favorites under `/public` |
| Track attributes | `GET /enums/trackAttributes`, `GET /enums/:type` |

Upload and analysis requests return `202 Accepted` with a job ID. Clients poll the corresponding status endpoint until the job completes or fails.

## Testing and quality checks

```bash
npm test -- --runInBand
npm run db:init
npm run db:verify
npm run smoke
npm run storage:verify
npm run registration:verify
```

`npm run smoke` checks health, session, public-track, and track-attribute responses against `API_BASE_URL` or the local API. `db:init` is rerunnable and `db:verify` checks the expected tables, columns, sequences, and enum values. The two local verifiers require the Compose storage/Mailpit stack and never contact AWS or Resend.

On every push and pull request, GitHub Actions runs the Jest suite, a production dependency audit, Python syntax checks, PostgreSQL schema checks, live API smoke tests with PostgreSQL and Redis, a production Docker build, and Terraform validation. Dependabot checks application and infrastructure dependencies weekly.

## Deployment and operations

Production runs on one Ubuntu EC2 instance with a Terraform-managed Elastic IP. Nginx terminates HTTPS using a Let's Encrypt certificate and proxies to the API managed by systemd. Certbot renews the certificate automatically, and a scheduled workflow warns when the public certificate has 30 days or less remaining.

Terraform manages the EC2 instance, network rules, private encrypted S3 bucket, runtime IAM permissions, Elastic IP, GitHub deployment identity, Systems Manager deployment command, and CloudWatch status/CPU alarms. The canonical infrastructure definitions live in [`infrastructure/terraform/`](infrastructure/terraform/), while tracked host and proxy configuration lives in [`deploy/`](deploy/).

Production deployment is an explicit GitHub Actions dispatch from `main` through the `production` environment. The workflow:

1. Requires tests, the Docker build, and Terraform validation to pass.
2. Exchanges GitHub's OIDC identity for short-lived, scoped AWS credentials.
3. Uploads a release archive to S3 and verifies its SHA-256 checksum on EC2.
4. Runs the deployment through AWS Systems Manager instead of SSH.
5. Reconciles and validates managed configuration before downtime, then creates a local backup, installs dependencies, verifies the schema, and checks application and Nginx health.
6. Restores the previous application release automatically if installation or health checks fail.
7. Verifies the public HTTPS API and removes the temporary deployment artifact.

### Production environment

The production environment is stored only on the EC2 host at
`/etc/trackfusion/.env`. It is owned by `root`, has mode `0600`, and is loaded
explicitly by the systemd unit. Secrets, unknown variables, and
instance-specific settings remain operator-managed in that file and are never
generated from repository examples.

The tracked [`deploy/ec2/production-managed.env`](deploy/ec2/production-managed.env)
file is the source of truth for the small allowlist of deployment-managed,
non-secret settings: the frontend URL, API CORS origin, cookie policies, and
the production-only Resend/AWS provider selections. A deployment copies the existing host environment to a
root-protected temporary directory, reconciles only those allowlisted keys,
and validates the candidate with the incoming release while the current API is
still healthy. Invalid candidates abort without stopping or changing the
running service. Reconciliation is idempotent and never sources the environment
file or prints its values.

After candidate validation, deployment stops the service, backs up the current
application and all of `/etc/trackfusion`, verifies that the source environment
did not change during preflight, and atomically installs the candidate. Any
later failure restores the prior application and configuration. The first
deployment may use the protected legacy `/etc/trackfusion/api.env` as its
source; that file is removed only after the new service passes direct and Nginx
health checks. The existing `secrets.env` remains a protected recovery artifact
and is not loaded by the current service.

A rebuilt host must restore `.env` (or the legacy `api.env`) from a protected
backup before deployment. The deployment scripts deliberately refuse to invent
a missing production file or generate replacement database and authentication
secrets.

Change deployment-managed settings in `production-managed.env` through normal
review and deployment. To change an operator-managed or instance-specific
setting, edit the host file with `sudoedit`, retain a protected copy until
verification is complete, validate it, restart the service, and check health:

```bash
sudoedit /etc/trackfusion/.env
sudo chown root:root /etc/trackfusion/.env
sudo chmod 0600 /etc/trackfusion/.env
sudo /usr/local/bin/node --env-file=/etc/trackfusion/.env /opt/trackfusion/api/scripts/validateEnvironment.js
sudo systemctl restart trackfusionweb-api
curl -fsS https://api.trackfusionweb.com/health
```

Never print, source, commit, or place this file in a release directory. A
configuration change takes effect only after `trackfusionweb-api` is restarted.
For local development, create `.env` from `.env.example` only when it does not
already exist; that local file is ignored by Git and is unrelated to the host
configuration.

Production is locked to Resend and AWS S3. Provider selection is deployment
managed; production rejects `smtp` and `s3-compatible` providers. The protected
host environment retains its existing bucket/region and uses the EC2 IAM role,
not static credentials:

```dotenv
EMAIL_DELIVERY_ENABLED=true
RESEND_API_KEY=replace_with_the_protected_resend_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=replace_with_the_production_bucket
```

The sender is fixed in code to the verified `mail.trackfusionweb.com` domain.
Do not put the API key in `production-managed.env`, GitHub Actions variables,
the repository, or deployment output. For the first Resend deployment, add the
new values but retain legacy provider values until the release is healthy and
its rollback window has passed; then remove the obsolete provider variables.
The retained `/etc/trackfusion/secrets.env` file is a recovery artifact and is
not loaded by the service.

Production uses exact-origin CORS for `https://www.trackfusionweb.com`, secure
host-only cookies, and `SameSite=Lax`. The frontend and API are different
origins but the same HTTPS site, so credentialed requests remain compatible.
Do not grant wildcard or regex access to Vercel previews. A preview requiring
authentication should use an isolated non-production API with its exact preview
origin explicitly configured.

## Security

- Passwords are hashed with bcrypt. Verification codes, registration grants,
  and password-reset tokens are hashed at rest, time-limited, attempt-limited
  where applicable, and consumed once.
- Authentication cookies are HTTP-only and use secure production settings. Sessions are stored in Redis.
- Helmet headers, exact-origin CORS, request-size limits, Joi validation, and global/authentication/OTP rate limits protect the API boundary.
- S3 public access is blocked. Upload and playback access use expiring signed URLs and user-scoped object keys.
- EC2 uses an IAM role, while GitHub uses OIDC. Neither deployment path requires long-lived AWS keys in the repository.
- Only ports 80 and 443 are public for application traffic; SSH is restricted to a configured address.
- Production secrets are stored in the root-readable `/etc/trackfusion/.env` on the host and are excluded from release artifacts.

## Known limitations

- Bull processors still run in the API process to preserve the production
  systemd topology. A dedicated worker process is a future scaling improvement,
  not required for local portability.
- The current frontend can continue using the session-based compatibility flow,
  but should adopt the explicit registration grant and avoid modifying signed
  profile URLs as described in the browser workflow above.
- Local verification records and finalized media are intentionally retained in
  named volumes so developers can inspect them. Stop with `docker compose down`;
  cleanup is manual and must not target production data.

## Future improvements

- Separate PostgreSQL, Redis, and the API into independently scalable services as traffic and availability requirements grow.
- Replace the rerunnable schema initializer with versioned database migrations for safer, traceable schema changes.
- Add end-to-end email-delivery monitoring if transactional volume grows enough
  to justify provider webhooks.
- Expand automated coverage for controllers, background queues, S3 workflows, and end-to-end user journeys.

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
- Direct browser uploads to a private Amazon S3 bucket through time-limited presigned URLs.
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
| Amazon S3 and AWS SDK v3 | Private media storage, presigned uploads, and signed playback. |
| Nginx and systemd | TLS termination, reverse proxying, and API process supervision on EC2. |
| Terraform and GitHub Actions | Reproducible AWS infrastructure and tested, keyless deployments. |
| Jest and Docker Compose | Unit testing and a repeatable local service stack. |

Mailgun support is implemented for verification and password-reset email, but delivery is controlled by configuration.

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
   `-- Amazon S3        private audio and image objects

Browser <---- time-limited presigned upload/playback URLs ----> S3
```

Nginx is the only public application entry point in production. It redirects HTTP to HTTPS and forwards requests to Express on the EC2 loopback interface. PostgreSQL, Redis, and Express are not exposed publicly.

For uploads, the API issues a user-scoped S3 URL and the browser transfers the file directly to S3. The client then submits metadata to the API. A Bull worker downloads and validates the file, extracts audio metadata, moves it to its final S3 key, and stores the database record. Job-status endpoints only return jobs owned by the authenticated user.

For playback, the API checks the track's privacy and ownership before returning a short-lived S3 URL. Public catalog records therefore do not require the bucket itself to be public.

## Getting started

### Docker Compose

Docker Compose is the quickest way to run the API, PostgreSQL, and Redis together.

```bash
cp .env.example .env
# Replace the password and secret placeholders in .env.
docker compose up --build
```

The API listens on `http://127.0.0.1:8081`. Verify it in another terminal:

```bash
curl http://127.0.0.1:8081/health
```

The Compose stack initializes the database before starting Express and keeps PostgreSQL and Redis data in named volumes. Run `docker compose down` to stop it without deleting that data.

S3-backed features require a valid bucket and AWS credentials discoverable by the AWS SDK. With Compose, export temporary AWS credential variables in the launching shell. The application can still start for health and non-storage development with the placeholder bucket from `.env.example`.

### Run directly

Install Node.js 22+, Python 3.12, FFmpeg, PostgreSQL, and Redis. Create a PostgreSQL database matching `DATABASE_URL`, start PostgreSQL and Redis, then run:

```bash
cp .env.example .env
npm ci
python3 -m venv venv
venv/bin/pip install -r requirements.txt
npm run db:init
npm run dev
```

`.env.example` documents the required server, cookie, database, Redis, AWS, email, and media-limit settings. Generate independent secrets of at least 32 characters. Do not store AWS access keys in `.env`; use the standard AWS credential chain instead.

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
```

`npm run smoke` checks health, session, public-track, and track-attribute responses against `API_BASE_URL` or the local API. `db:init` is rerunnable and `db:verify` checks the expected tables, columns, sequences, and enum values.

On every push and pull request, GitHub Actions runs the Jest suite, a production dependency audit, Python syntax checks, PostgreSQL schema checks, live API smoke tests with PostgreSQL and Redis, a production Docker build, and Terraform validation. Dependabot checks application and infrastructure dependencies weekly.

## Deployment and operations

Production runs on one Ubuntu EC2 instance with a Terraform-managed Elastic IP. Nginx terminates HTTPS using a Let's Encrypt certificate and proxies to the API managed by systemd. Certbot renews the certificate automatically, and a scheduled workflow warns when the public certificate has 30 days or less remaining.

Terraform manages the EC2 instance, network rules, private encrypted S3 bucket, runtime IAM permissions, Elastic IP, GitHub deployment identity, Systems Manager deployment command, and CloudWatch status/CPU alarms. The canonical infrastructure definitions live in [`infrastructure/terraform/`](infrastructure/terraform/), while tracked host and proxy configuration lives in [`deploy/`](deploy/).

Production deployment is an explicit GitHub Actions dispatch from `main` through the `production` environment. The workflow:

1. Requires tests, the Docker build, and Terraform validation to pass.
2. Exchanges GitHub's OIDC identity for short-lived, scoped AWS credentials.
3. Uploads a release archive to S3 and verifies its SHA-256 checksum on EC2.
4. Runs the deployment through AWS Systems Manager instead of SSH.
5. Creates a local backup, installs dependencies, verifies the schema, and checks application and Nginx health.
6. Restores the previous application release automatically if installation or health checks fail.
7. Verifies the public HTTPS API and removes the temporary deployment artifact.

### Production environment

The production environment is stored only on the EC2 host at
`/etc/trackfusion/.env`. It is owned by `root`, has mode `0600`, and is loaded
explicitly by the systemd unit; releases never copy it into the application
directory or regenerate it. Routine deployments back up all of
`/etc/trackfusion` with the release and preserve `.env` unchanged.

The first deployment with this convention copies the existing protected
`/etc/trackfusion/api.env` to `.env` atomically, preserves its credentials and
unrecognized settings, replaces the retired frontend origin with
`https://www.trackfusionweb.com`, and changes the production cookie policy to
`SameSite=Lax`. The old service definition and environment remain in the
pre-deployment backup. `api.env` is removed from the live configuration only
after the new service passes direct and Nginx health checks. The existing
`secrets.env` may remain as a protected legacy recovery artifact, but it is not
loaded by the current service and `.env` is authoritative.

A rebuilt host must restore `.env` from a protected backup before deployment.
The configuration script deliberately refuses to invent a missing production
file or generate replacement database and authentication secrets.

To change a production setting, edit the host file with `sudoedit`, retain a
protected copy until verification is complete, validate it, restart the
service, and check health:

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
For local development, copy the repository's `.env.example` to `.env`; that
local file is ignored by Git and is unrelated to the host configuration.

If the persistent file already contains the apex frontend URL, update only
`FRONTEND_URL` and `CORS_ALLOWED_ORIGINS` to
`https://www.trackfusionweb.com` before the next deployment. Deployments do not
rewrite an existing `.env` file.

Production uses exact-origin CORS for `https://www.trackfusionweb.com`, secure
host-only cookies, and `SameSite=Lax`. The frontend and API are different
origins but the same HTTPS site, so credentialed requests remain compatible.
Do not grant wildcard or regex access to Vercel previews. A preview requiring
authentication should use an isolated non-production API with its exact preview
origin explicitly configured.

## Security

- Passwords are hashed with bcrypt; reset tokens are time-limited and single-use.
- Authentication cookies are HTTP-only and use secure production settings. Sessions are stored in Redis.
- Helmet headers, exact-origin CORS, request-size limits, Joi validation, and global/authentication/OTP rate limits protect the API boundary.
- S3 public access is blocked. Upload and playback access use expiring signed URLs and user-scoped object keys.
- EC2 uses an IAM role, while GitHub uses OIDC. Neither deployment path requires long-lived AWS keys in the repository.
- Only ports 80 and 443 are public for application traffic; SSH is restricted to a configured address.
- Production secrets are stored in the root-readable `/etc/trackfusion/.env` on the host and are excluded from release artifacts.

## Future improvements

- Separate PostgreSQL, Redis, and the API into independently scalable services as traffic and availability requirements grow.
- Replace the rerunnable schema initializer with versioned database migrations for safer, traceable schema changes.
- Configure and verify Mailgun delivery before enabling registration OTP and password-reset emails in production.
- Expand automated coverage for controllers, background queues, S3 workflows, and end-to-end user journeys.

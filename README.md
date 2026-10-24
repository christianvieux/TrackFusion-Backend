# TrackFusionWeb API

TrackFusionWeb is a music-sharing application. This repository contains its Node.js API, authentication, PostgreSQL data model, Redis-backed sessions and job queues, S3 upload workflow, and Python audio analysis.

The backend can run directly on a development machine or behind Nginx on AWS EC2. AWS credentials are discovered through the standard SDK credential chain; permanent AWS keys do not belong in `.env`.

## Architecture

```text
Browser
  |
  | HTTPS (production)
  v
Nginx :80/:443
  |
  | HTTP on loopback
  v
Express :8081
  |-- PostgreSQL :5432 (users, tracks, tokens, metadata)
  |-- Redis :6379 (sessions and Bull queues)
  |-- Python + FFmpeg (audio download and analysis)
  `-- Amazon S3 (presigned uploads and private playback)
```

Production runs Express as the unprivileged `trackfusion` system user. PostgreSQL, Redis, and Express listen locally; only Nginx and restricted SSH are exposed by the host and AWS firewalls.

## Technology

- Node.js 22 or newer (the current EC2 deployment pins Node 24.16.0)
- Express 4
- PostgreSQL 16
- Redis 7 and Bull 4
- Python 3.12, librosa, NumPy, yt-dlp, and FFmpeg
- AWS SDK v3 and Amazon S3
- Mailgun when email delivery is enabled
- Nginx and systemd on EC2
- Jest for unit tests

## Repository layout

```text
controllers/       Request and application logic
deploy/            EC2 bootstrap, systemd, and Nginx files
docs/aws/          IAM and S3 CORS documents
docs/MODERNIZATION_HANDOFF.md
                   Evidence-based modernization state and restart point
middlewares/       Authentication, CORS, sessions, limits, and errors
python/scripts/    Audio conversion and analysis
queue/             Redis-backed Bull workers
routes/            Express routes
scripts/           Database, smoke, and AWS verification commands
services/          PostgreSQL, S3, email, image, and audio services
utils/             Shared validation and security helpers
init_database.sql  Rerunnable PostgreSQL schema
```

## Local development

### 1. Install prerequisites

Ubuntu example:

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-client redis-server ffmpeg python3-venv
```

Install Node.js 22 or newer separately, then confirm the tools:

```bash
node --version
python3 --version
pg_isready
redis-cli ping
ffmpeg -version
```

Redis should return `PONG`, and PostgreSQL should report that it accepts connections.

### 2. Create the local database role

Choose a strong local password and use the same value in `DATABASE_URL`:

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -c \
"CREATE ROLE trackfusion WITH LOGIN PASSWORD 'replace-with-a-strong-password';"

sudo -u postgres createdb --owner=trackfusion trackfusionweb_db
```

If these resources already exist, update the role password instead of recreating them:

```bash
sudo -u postgres psql -c \
"ALTER ROLE trackfusion WITH PASSWORD 'replace-with-a-strong-password';"
```

### 3. Configure the application

```bash
cp .env.example .env
```

Edit `.env`. Generate each application secret independently:

```bash
openssl rand -hex 32
```

The example file documents every variable. Important groups are:

| Group | Variables |
| --- | --- |
| Server | `NODE_ENV`, `HOST`, `PORT`, `REQUEST_BODY_LIMIT` |
| Browser | `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `DEV_URLS` |
| Auth | `SESSION_SECRET`, `JWT_SECRET`, `JWT_SECRET_PASSWORD_RESET` |
| Cookies | `COOKIE_SECURE`, `COOKIE_SAME_SITE`, optional `COOKIE_DOMAIN` |
| Data | `DATABASE_URL`, `REDIS_URL` |
| Python | `PYTHON_EXECUTABLE` |
| AWS | `AWS_REGION`, `AWS_PROFILE`, `AWS_S3_BUCKET` |
| Email | `EMAIL_DELIVERY_ENABLED`, `MAILGUN_*`, development exposure flags |
| Media | maximum duration/size and allowed MIME-type variables |

For local development without Mailgun, keep email delivery disabled and explicitly enable the two development-only token flags. They must remain disabled in production.

### 4. Install dependencies

```bash
npm ci
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

### 5. Initialize and verify PostgreSQL

```bash
npm run db:init
npm run db:verify
```

`db:init` is rerunnable. It creates missing enums, tables, sequences, constraints, and indexes without deleting existing application data.

### 6. Run and test

```bash
npm test -- --runInBand
npm start
```

In another terminal:

```bash
npm run smoke
```

The default local health URL is `http://127.0.0.1:8081/health`.

## NPM commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the API |
| `npm run dev` | Start with nodemon |
| `npm test -- --runInBand` | Run unit tests |
| `npm run db:init` | Apply the rerunnable database schema |
| `npm run db:verify` | Verify required tables and enums |
| `npm run smoke` | Check health and representative public endpoints |
| `npm run aws:verify` | Put, read, and remove one temporary S3 verification object |

`npm run aws:verify` mutates only a randomly named object under `deployment-check/` and removes it in a `finally` block.

## Docker

The production image contains only the API runtime, Python environment, and FFmpeg. PostgreSQL and Redis are separate services; they are not bundled into the API container.

For local Compose use:

```bash
cp .env.example .env
# Configure the application secrets and POSTGRES_PASSWORD in .env first.
docker compose config --quiet
docker compose up --build
```

Use `docker compose config --quiet` for validation. Plain `docker compose config` renders resolved environment values and can print secrets to the terminal or captured logs.

Then verify it from another terminal:

```bash
npm run smoke
```

Compose binds the API to `127.0.0.1:8081`, waits for PostgreSQL and Redis health checks, and applies the rerunnable schema before starting Express.

If a container needs S3, export refreshable credentials into the current shell before starting Compose:

```bash
eval "$(aws configure export-credentials \
  --profile trackfusion-local --format env)"
docker compose up --build
```

These credentials are temporary and are passed through the process environment; they are not copied into the image or `.env`.

Stop the stack without deleting its database and Redis volumes:

```bash
docker compose down
```

`docker compose down --volumes` permanently deletes the local container data and should be used only when a full reset is intended.

## AWS authentication

### Local machine

The preferred workflow uses refreshable temporary console credentials:

```bash
aws login --profile trackfusion-local --region us-east-1
aws sts get-caller-identity --profile trackfusion-local
```

Set `AWS_PROFILE=trackfusion-local` locally. Do not add access-key IDs or secret keys to `.env`.

### EC2

The instance uses its attached IAM role automatically. No AWS credential variables or files are deployed to EC2.

Canonical AWS names:

| Resource | Name |
| --- | --- |
| S3 bucket | `trackfusionweb-audio.s3bucket-020457827871-us-east-1-an` |
| IAM policy | `TrackFusionWeb-API_Policy` |
| IAM role/profile | `TrackFusionWeb-API_Role` |
| EC2 instance | `TrackFusionWeb-API-EC2` |
| Security group | `TrackFusionWeb-API-SG` |
| GitHub deploy policy | `TrackFusionWeb-GitHub-Deploy_Policy` |
| GitHub deploy role | `TrackFusionWeb-GitHub-Deploy_Role` |
| SSM deploy document | `TrackFusionWeb-Deploy` |
| Terraform state bucket | `trackfusionweb-terraform-state-020457827871-us-east-1` |

The policy grants only `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` for objects in this bucket. See [the policy document](docs/aws/TrackFusionWeb-API_Policy.json), [EC2 trust policy](docs/aws/TrackFusionWeb-API_TrustPolicy.json), and [bucket CORS configuration](docs/aws/TrackFusionWeb-S3-CORS.json).

The bucket blocks public access and uses server-side encryption. Browser access uses short-lived presigned URLs.

## Terraform infrastructure

The live API bucket, IAM policy/role/profile, security group/rules, and EC2 instance are managed from [`infrastructure/terraform`](infrastructure/terraform). They were imported under their existing canonical `TrackFusionWeb-*` names; Terraform did not recreate them.

State is encrypted and versioned in the dedicated private bucket `trackfusionweb-terraform-state-020457827871-us-east-1`. The main configuration deliberately does not manage that bootstrap bucket, preventing a state operation from deleting its own backend.

```bash
cp infrastructure/terraform/terraform.tfvars.example \
  infrastructure/terraform/terraform.tfvars
# Set developer_ssh_cidr to the trusted public IPv4 address followed by /32.

AWS_PROFILE=trackfusion-local terraform -chdir=infrastructure/terraform init
AWS_PROFILE=trackfusion-local terraform -chdir=infrastructure/terraform fmt -check -recursive
AWS_PROFILE=trackfusion-local terraform -chdir=infrastructure/terraform validate
AWS_PROFILE=trackfusion-local terraform -chdir=infrastructure/terraform plan
```

The real `terraform.tfvars`, local provider directory, saved plans, and any local state files are ignored. The one-time import identifiers are documented in [`infrastructure/terraform/IMPORTS.md`](infrastructure/terraform/IMPORTS.md); do not rerun imports against the populated state.

## CI/CD

The workflow at [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs on pull requests and pushes. It performs:

- Node dependency installation and production dependency audit;
- all Jest tests plus Python bytecode compilation;
- PostgreSQL schema initialization/verification and live API smoke tests against PostgreSQL and Redis service containers;
- a real production Docker image build;
- Terraform formatting, offline-backend initialization, and validation.

A deployment runs only after every job succeeds and only for `main` (either a push or a manual dispatch from `main`). GitHub obtains short-lived AWS credentials through OIDC; there are no AWS access keys or SSH private keys in repository secrets. The deployment role can only upload/remove an object under the bucket's `deployments/` prefix, invoke `TrackFusionWeb-Deploy` on the one API instance, read that command's result, and discover the instance's public address.

The SSM document downloads the release on EC2, verifies its SHA-256 checksum, validates required files, synchronizes the release, reruns the idempotent database/configuration checks, restarts the service, and verifies both direct and Nginx health. The workflow removes its S3 artifact even after a failed deployment.

In GitHub, create or review the `production` environment under **Settings → Environments** and protect it so only `main` can deploy. An optional required reviewer provides a manual approval gate. The AWS trust policy is already restricted to this repository and environment.

Dependabot configuration at [`.github/dependabot.yml`](.github/dependabot.yml) checks npm, Python, Docker, Terraform, and GitHub Actions dependencies weekly.

## Monitoring

Terraform manages two standard-resolution CloudWatch alarms without installing another agent or log pipeline:

- `TrackFusionWeb-API-StatusCheckFailed` for two consecutive failed EC2 status checks;
- `TrackFusionWeb-API-HighCPU` for average CPU at or above 80% for 15 minutes.

They are visible in CloudWatch immediately. To receive email notifications, set `monitoring_alert_email` in the ignored `infrastructure/terraform/terraform.tfvars`, run a reviewed Terraform plan/apply, and confirm the subscription email sent by AWS. Until an address is explicitly configured, Terraform does not create an unused SNS topic.

These two alarm metrics fit within CloudWatch's current account free tier of 10 standard-resolution alarm metrics if that allowance is otherwise unused. Systems Manager Run Command on EC2 and IAM/OIDC have no additional service charge. Always confirm the current AWS pricing pages and the account's actual usage before assuming a zero-dollar total.

## Current EC2 deployment

The initial deployment intentionally avoids a load balancer, NAT gateway, RDS, ElastiCache, and Elastic IP. PostgreSQL and Redis run on the same `t3.small` instance to keep the first deployment inexpensive and understandable.

Current design:

- Ubuntu 24.04 LTS, `t3.small`
- 20 GiB encrypted gp3 root volume
- 2 GiB swap file for installation and occasional audio-processing pressure
- IMDSv2 required
- T3 standard CPU credits to prevent surplus-credit charges
- ports 80/443 public; port 22 restricted to the developer IP
- ports 5432, 6379, and 8081 not publicly exposed
- Nginx proxies to `127.0.0.1:8081`
- systemd restarts the API after failures and at boot

The public IPv4 address is temporary and can change after a stop/start cycle.

### Reproduce the manual host setup

Copy a secret-free release to the instance, then run:

```bash
sudo bash deploy/ec2/bootstrap-host.sh
sudo rsync -a /path/to/release/ /opt/trackfusion/api/
sudo bash /opt/trackfusion/api/deploy/ec2/configure-app.sh
```

`bootstrap-host.sh` installs and verifies the system dependencies. `configure-app.sh`:

- generates server-only secrets under `/etc/trackfusion/`;
- creates the local database role and database;
- installs Node and Python dependencies;
- initializes and verifies the schema;
- installs the systemd and Nginx configurations;
- restarts the API and waits for its direct health check.

The dedicated `trackfusion` system user is created by `bootstrap-host.sh`. Run both direct and proxied curls below after configuration.

Useful production commands:

```bash
sudo systemctl status trackfusionweb-api
sudo journalctl -u trackfusionweb-api -f
sudo systemctl restart trackfusionweb-api
sudo nginx -t
sudo systemctl reload nginx
curl http://127.0.0.1:8081/health
curl http://127.0.0.1/health
```

## HTTPS and cookies

The API is currently reachable over HTTP for deployment verification. Production authentication intentionally uses `Secure` cookies, so browser login will not work until HTTPS is configured.

To finish HTTPS:

1. Choose an API hostname, such as `api.example.com`.
2. Give the instance a stable address before relying on DNS.
3. Point the hostname's DNS `A` record to that address.
4. Replace Nginx's catch-all `server_name` with the hostname.
5. Install Certbot and request the certificate:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
sudo certbot renew --dry-run
```

6. Set `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, and cookie values appropriately in `/etc/trackfusion/api.env`, then restart the API.
7. Point `NEXT_PUBLIC_API_URL` in the frontend to the HTTPS API URL and redeploy the frontend.

For the Vercel frontend and a separately hosted API, use `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=none`.

## Email delivery

Email delivery is feature-gated with `EMAIL_DELIVERY_ENABLED`.

When disabled in production:

- OTP generation returns `503 Email verification is temporarily unavailable`;
- password-reset requests keep the same generic response for every address;
- no OTP or reset token is exposed.

To enable registration and password reset, configure a real Mailgun domain and set:

```env
EMAIL_DELIVERY_ENABLED=true
EMAIL_VALIDATE_MX=true
MAILGUN_API_KEY=...
MAILGUN_DOMAIN=...
MAILGUN_FROM_EMAIL=TrackFusion <noreply@example.com>
```

Restart the API and test delivery before advertising those workflows.

## Representative API routes

| Area | Routes |
| --- | --- |
| Health | `GET /health` |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, password reset/change routes |
| OTP | `POST /otp/generate`, `POST /otp/verify`, `GET /otp/cooldown` |
| Users | `POST /users/register`, `POST /users/check-email`, `GET /users/info/:userId` |
| Tracks | public/user/favorite/detail/update/delete and authorized-playback routes under `/tracks` |
| Uploads | `POST /aws/presigned-url`, processing and job-status routes under `/upload` |
| Audio | authenticated conversion/analysis routes under `/audio` |
| Public | public user track/favorite routes under `/public` |
| Enums | `GET /enums/trackAttributes`, `GET /enums/:type` |

Protected routes use the verified JWT identity, and queued-job/status access is restricted to the owning user.

## Security notes

- Never commit `.env`, AWS credentials, private keys, Mailgun keys, database passwords, or generated server files.
- Use a unique 32-byte-or-longer value for each production secret.
- EC2 receives temporary AWS credentials from `TrackFusionWeb-API_Role`.
- GitHub Actions receives short-lived, repository- and environment-scoped credentials through OIDC.
- The S3 bucket remains private; client transfers use presigned URLs.
- PostgreSQL, Redis, and Express are bound behind network controls.
- Rate limits protect global, authentication, and OTP endpoints.
- Session data is stored in Redis rather than Express memory.
- Passwords are hashed with bcrypt; password-reset tokens are single-use and time-limited.
- Review logs before sharing them; request bodies and database parameters can contain private data.

## Troubleshooting

### API will not start

```bash
sudo journalctl -u trackfusionweb-api -n 100 --no-pager
```

The startup sequence validates configuration and verifies PostgreSQL and Redis before listening.

### Database failure

```bash
pg_isready
npm run db:verify
```

Confirm the role password in `DATABASE_URL` matches PostgreSQL.

### Redis failure

```bash
redis-cli ping
sudo systemctl status redis-server
```

### S3 failure

```bash
aws sts get-caller-identity --profile trackfusion-local
npm run aws:verify
```

On EC2, also confirm `TrackFusionWeb-API_Role` is attached and inspect the service journal.

### Browser requests fail

Check all three layers:

- Express `CORS_ALLOWED_ORIGINS` contains the exact frontend origin;
- S3 CORS contains the origin for direct presigned transfers;
- the frontend uses the HTTPS API URL and sends credentials where required.

## Modernization status

- Phase 1: backend audit, local stabilization, tests, and local integration complete
- Phase 2: initial EC2 deployment, IAM role, database, Redis, Nginx, S3, and remote smoke tests complete
- Phase 3: documentation aligned with the working system
- Phase 4: production image and Compose topology passed local build, health, schema, and smoke checks; clean rebuild after a build-context exclusion fix pending
- Phase 5: existing AWS resources imported into encrypted remote Terraform state; configuration validated and converged with a no-change plan
- Phase 6: CI/CD workflow, keyless GitHub-to-AWS deployment path, dependency updates, and baseline CloudWatch monitoring implemented locally
- Remaining production prerequisites: API domain/HTTPS and Mailgun credentials
- Pending external verification: the first local or GitHub-hosted Docker build and the first GitHub workflow run after this branch is pushed


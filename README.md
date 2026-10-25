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

## Naming conventions

New names use `TrackFusionWeb` for the product and shared resources, `TrackFusionWeb API` in human-readable API labels, and `trackfusionweb-api` for package, image, and Linux container names. Terraform resource labels remain `snake_case`, JavaScript remains `camelCase`, and established environment-variable names remain unchanged.

Some older identifiers are compatibility-sensitive and intentionally remain unchanged: the `trackfusion` PostgreSQL and EC2 Linux roles, `trackfusionweb_db`, Compose project `trackfusionweb` and its named volumes, `/opt/trackfusion` and `/etc/trackfusion`, Redis session prefix `trackfusion:session:`, Terraform state addresses, deployment artifact names, and existing AWS resource names. Renaming any of these requires a planned data, host, repository, state, or infrastructure migration.

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
  --profile trackfusionweb-admin --format env)"
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

The preferred workflow uses refreshable IAM Identity Center credentials:

```bash
aws sso login --profile trackfusionweb-admin
aws sts get-caller-identity --profile trackfusionweb-admin
```

Set `AWS_PROFILE=trackfusionweb-admin` locally. Do not add access-key IDs or secret keys to `.env`.

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

AWS_PROFILE=trackfusionweb-admin terraform -chdir=infrastructure/terraform init
AWS_PROFILE=trackfusionweb-admin terraform -chdir=infrastructure/terraform fmt -check -recursive
AWS_PROFILE=trackfusionweb-admin terraform -chdir=infrastructure/terraform validate
AWS_PROFILE=trackfusionweb-admin terraform -chdir=infrastructure/terraform plan
```

The real `terraform.tfvars`, local provider directory, saved plans, and any local state files are ignored. The one-time import identifiers are documented in [`infrastructure/terraform/IMPORTS.md`](infrastructure/terraform/IMPORTS.md); do not rerun imports against the populated state.

## CI/CD

The workflow at [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs on pull requests and pushes. It performs:

- Node dependency installation and production dependency audit;
- all Jest tests plus Python bytecode compilation;
- PostgreSQL schema initialization/verification and live API smoke tests against PostgreSQL and Redis service containers;
- a real production Docker image build;
- Terraform formatting, offline-backend initialization, and validation.

A deployment runs only after every job succeeds and only for an explicit manual dispatch from `main`. Pushes and pull requests still run CI but never deploy. GitHub obtains short-lived AWS credentials through OIDC; there are no AWS access keys or SSH private keys in repository secrets. The deployment role can only upload/remove an object under the bucket's `deployments/` prefix, invoke `TrackFusionWeb-Deploy` on the one API instance, read that command's result, and discover the instance's public address. The new HTTPS workflow no longer needs the discovery call, but the read-only permission remains during cutover so the currently deployed workflow stays usable.

The SSM document downloads the release on EC2, verifies its SHA-256 checksum, and validates required files before it changes the running installation. The host then stops the API briefly, creates a protected local backup, installs the release, runs database compatibility checks, and verifies both direct and Nginx health. An installation or health-check failure automatically restores the prior application, configuration, systemd unit, and Nginx files. The workflow removes its S3 artifact even after a failed deployment.

Pre-deployment backups are stored under `/var/backups/trackfusionweb-api` with root-only permissions. Each backup contains the previously working release (including its installed dependencies), `/etc/trackfusion` production configuration and secrets, the installed systemd/Nginx files, a local uploads archive, and a consistent custom-format PostgreSQL dump. The three newest backups are retained after successful releases. Deployments never overwrite `/opt/trackfusion/api/uploads` or objects in the production S3 bucket, and automatic rollback deliberately does not restore uploads or PostgreSQL: replacing either automatically could discard data written after the backup. Their snapshots remain available for a separately reviewed recovery if necessary.

`init_database.sql` remains an idempotent initializer rather than a versioned migration system. Initialization now runs in one transaction under a PostgreSQL advisory lock, and deployment verifies all expected tables, columns, sequences, enum types, and enum labels. If an existing database is structurally incompatible, installation stops and the application release rolls back; the database dump is preserved for diagnosis. Future schema changes still require reviewed forward and rollback migrations before deployment.

In GitHub, create or review the `production` environment under **Settings → Environments** and protect it so only `main` can deploy. An optional required reviewer provides a manual approval gate. The AWS trust policy is already restricted to this repository and environment.

Dependabot configuration at [`.github/dependabot.yml`](.github/dependabot.yml) checks npm, Python, Docker, Terraform, and GitHub Actions dependencies weekly.

## Monitoring

Terraform manages two standard-resolution CloudWatch alarms without installing another agent or log pipeline:

- `TrackFusionWeb-API-StatusCheckFailed` for two consecutive failed EC2 status checks;
- `TrackFusionWeb-API-HighCPU` for average CPU at or above 80% for 15 minutes.

They are visible in CloudWatch immediately. To receive email notifications, set `monitoring_alert_email` in the ignored `infrastructure/terraform/terraform.tfvars`, run a reviewed Terraform plan/apply, and confirm the subscription email sent by AWS. Until an address is explicitly configured, Terraform does not create an unused SNS topic.

These two alarm metrics fit within CloudWatch's current account free tier of 10 standard-resolution alarm metrics if that allowance is otherwise unused. Systems Manager Run Command on EC2 and IAM/OIDC have no additional service charge. Always confirm the current AWS pricing pages and the account's actual usage before assuming a zero-dollar total.

## Production Deployment & HTTPS

Production remains one Ubuntu 24.04 `t3.small` EC2 instance. PostgreSQL, Redis, and Express are local to that host; ports 5432, 6379, and 8081 are not public. Nginx accepts public traffic on ports 80 and 443 and forwards it to Express at `127.0.0.1:8081`. This lets Nginx manage certificates and redirects while the Node process stays unprivileged and off the public network.

### DNS, the stable address, and TLS

IONOS DNS connects a name to an address. The production record is:

| IONOS field | Value |
| --- | --- |
| Type | `A` |
| Host/name | `api` |
| Value | the reviewed `terraform output -raw api_public_ip` value |
| TTL | `300` during cutover; raise it later if desired |

The October 25, 2026 audit found `api.trackfusionweb.com` pointing to the instance's temporary address `3.91.170.191`, with no Elastic IP allocated. Terraform now declares one Elastic IP and its association, but it must not be applied until the Phase B plan is reviewed. Association replaces the temporary address and can briefly interrupt access while the IONOS record changes. Do not edit the root domain, MX, TXT, or other unrelated records.

A TLS certificate proves to browsers that they reached `api.trackfusionweb.com` and encrypts data in transit. Let's Encrypt issues that certificate through Certbot. The private key remains root-readable under `/etc/letsencrypt`; it is never stored in Git, S3 deployment artifacts, or application backups.

Before a certificate exists, [`deploy/nginx/trackfusionweb-api.conf`](deploy/nginx/trackfusionweb-api.conf) serves HTTP and the ACME challenge without referring to nonexistent certificate files. [`deploy/ec2/setup-https.sh`](deploy/ec2/setup-https.sh) then:

1. verifies that DNS resolves to the EC2 instance;
2. installs Ubuntu's Certbot package;
3. requests the certificate through the HTTP webroot challenge;
4. validates and gracefully reloads Nginx with the tracked TLS configuration;
5. creates the non-secret `/etc/nginx/trackfusionweb-api-https-enabled` marker, which changes ordinary HTTP requests to a fixed-host HTTPS redirect;
6. enables the packaged `certbot.timer` and runs a renewal dry-run.

The exact reviewed activation sequence is in [`docs/PRODUCTION_HTTPS_ROLLOUT.md`](docs/PRODUCTION_HTTPS_ROLLOUT.md). It is a separate production operation; routine releases never reinstall Certbot or request certificates.

### Automatic renewal and expiry warning

Ubuntu's `certbot.timer` checks periodically and renews only when a certificate is near expiry. A deploy hook runs `nginx -t` and then gracefully reloads Nginx so new workers adopt a renewed certificate while current connections can finish. A weekly GitHub Actions check fails when the public certificate cannot be verified or has 30 days or less remaining. That check has no AWS resource cost, but its warning depends on GitHub Actions and repository notifications remaining enabled.

Useful renewal commands:

```bash
# Show whether the packaged renewal timer is enabled and waiting.
sudo systemctl status certbot.timer
sudo systemctl list-timers certbot.timer

# List the installed certificate and its expiry date.
sudo certbot certificates
openssl s_client -connect api.trackfusionweb.com:443 \
  -servername api.trackfusionweb.com </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -issuer -subject

# Exercise Let's Encrypt's staging renewal path. Run after live activation.
sudo certbot renew --dry-run --cert-name api.trackfusionweb.com

# Inspect renewal attempts and the Nginx reload hook.
sudo journalctl -u certbot.service -n 100 --no-pager
sudo tail -n 100 /var/log/letsencrypt/letsencrypt.log
```

Renewal is designed to avoid an API restart, but zero downtime cannot be guaranteed. Expired DNS records, blocked port 80, Let's Encrypt outages or rate limits, a full disk, invalid Nginx configuration, a stopped timer, or disabled GitHub notifications can prevent renewal or hide its failure.

### Future application deployments

Production deployments remain manual `workflow_dispatch` runs from `main` through the protected `production` environment. GitHub uses OIDC, uploads a checksum-protected release to S3, and invokes the existing `TrackFusionWeb-Deploy` SSM document. The host backs up the current release, installs the new one, and checks both Express directly and Nginx over HTTPS. The workflow then checks `https://api.trackfusionweb.com` from outside AWS. It does not use an insecure HTTP fallback.

`configure-app.sh` updates the tracked Nginx application configuration only after confirming that an active HTTPS marker still has certificate files. It does not modify `/etc/letsencrypt` or the Certbot deploy hook. This preserves certificates and keys across releases.

### Authentication and frontend compatibility

The existing frontend remains `https://trackfusionweb.vercel.app`. Production configuration uses:

```env
FRONTEND_URL=https://trackfusionweb.vercel.app
CORS_ALLOWED_ORIGINS=https://trackfusionweb.vercel.app
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

The cookies are `HttpOnly`, `Secure`, host-only, and `SameSite=None`; do not set `COOKIE_DOMAIN` for the Vercel/API split. Express trusts exactly one proxy hop, the session middleware is proxy-aware, CORS allows credentials only for the exact configured origin, and Nginx preserves `Host`, client IP, and forwarded protocol headers. The frontend must set its API URL to `https://api.trackfusionweb.com` and send credentials (for example, `credentials: "include"`) for login, logout, session, and other cookie-authenticated calls. Password-reset links continue to use `FRONTEND_URL`; OTP behavior is unchanged. Cross-site cookies may still be blocked by browser privacy settings, so test the actual supported browsers.

### Verify production

```bash
# Application and proxy configuration.
sudo systemctl status trackfusionweb-api --no-pager
sudo journalctl -u trackfusionweb-api -n 100 --no-pager
sudo nginx -t
sudo systemctl status nginx --no-pager

# Direct loopback and public HTTPS health.
curl -fsS http://127.0.0.1:8081/health
curl -fsS --proto '=https' --tlsv1.2 https://api.trackfusionweb.com/health

# HTTP must redirect to the fixed HTTPS hostname.
curl -sSI http://api.trackfusionweb.com/health

# Check the full public smoke set.
API_BASE_URL=https://api.trackfusionweb.com npm run smoke
```

### Backups, rollback, and recovery

The existing guarded release process is unchanged. Pre-deployment backups under `/var/backups/trackfusionweb-api` now also capture the HTTP, shared proxy, and TLS Nginx files plus the HTTPS marker. Certificates are intentionally excluded and remain in `/etc/letsencrypt`. Older pre-HTTPS backups remain accepted; missing TLS-era paths are treated as absent.

```bash
sudo ls -1 /var/backups/trackfusionweb-api
sudo bash /opt/trackfusion/api/deploy/ec2/rollback-release.sh \
  /var/backups/trackfusionweb-api/YYYYMMDDTHHMMSSZ-RELEASE_SHA
```

Rollback restores the application, `/etc/trackfusion`, systemd unit, and Nginx state, then validates Nginx before reloading. It does not automatically restore PostgreSQL or uploads because that could erase newer data. If initial HTTPS activation fails before passing health checks, the setup script restores its pre-activation Nginx files; any issued certificate is retained for diagnosis and a safe retry.

### Troubleshooting HTTPS

- **DNS still shows the old address:** compare `getent ahostsv4 api.trackfusionweb.com` with `terraform output -raw api_public_ip`. Update only the IONOS `api` A record and allow for its TTL.
- **Certificate issuance fails:** confirm public port 80 is open and `curl http://api.trackfusionweb.com/.well-known/acme-challenge/test` reaches this Nginx host (a `404` is expected when no test file exists). Review `/var/log/letsencrypt/letsencrypt.log` before retrying to avoid rate limits.
- **Nginx will not reload:** run `sudo nginx -t`; the old workers normally continue serving until configuration validates. Do not restart Nginx as a first response.
- **Browser login fails:** verify the frontend HTTPS API URL, `credentials: "include"`, the exact CORS origin, both `Secure`/`SameSite=None` cookie attributes, and browser third-party-cookie policy. Inspect the response `Set-Cookie` headers without sharing token values.
- **Renewal warning fires:** run `sudo certbot renew --dry-run --cert-name api.trackfusionweb.com`, inspect the timer and logs above, and confirm DNS and ports 80/443 before changing certificate files.

The architecture still avoids a load balancer, NAT gateway, RDS, and ElastiCache. As of October 25, 2026, AWS lists both in-use and idle public IPv4 addresses at `$0.005` per hour (about `$3.60` for a 30-day month). The Elastic IP replaces the already billed temporary public IPv4 address, so it should not increase steady-state address count or cost; it continues billing if left idle. Confirm pricing and actual account usage again before Phase B.

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
MAILGUN_FROM_EMAIL=TrackFusionWeb <noreply@example.com>
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
aws sts get-caller-identity --profile trackfusionweb-admin
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
- Phase 5: existing AWS resources imported into encrypted remote Terraform state; the reviewed HTTPS plan remains unapplied (`2 to add, 0 to change, 0 to destroy`)
- Phase 6: keyless GitHub-to-AWS deployment, guarded backup/rollback, and baseline CloudWatch monitoring deployed successfully
- Remaining production prerequisites: approved HTTPS production activation and Mailgun credentials
- Pending external verification: Elastic IP/DNS cutover, initial certificate issuance, renewal dry-run, public HTTPS workflow checks, and browser authentication regression testing

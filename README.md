# TrackFusionWeb API

[![CI](https://github.com/christianvieux/trackfusionweb-api/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/christianvieux/trackfusionweb-api/actions/workflows/ci-cd.yml)

The API for **TrackFusionWeb**, a music-sharing app for uploading, discovering,
organizing, and analyzing tracks.

[Live app](https://www.trackfusionweb.com) ·
[Production API health](https://api.trackfusionweb.com/health) ·
[App repository](https://github.com/christianvieux/TrackFusion-Frontend)

These are the current production addresses for TrackFusionWeb. Local `.env`
changes do not change these hosted links.

## What this API does

- Creates accounts and handles secure sign-in.
- Stores track details, profiles, favorites, and privacy settings.
- Uploads and serves private audio and profile images.
- Analyzes audio for BPM and musical key.
- Sends verification and password-reset emails.

## Technology at a glance

| Technology | Role in the project |
| --- | --- |
| Node.js and Express | Runs the API and handles browser requests |
| PostgreSQL | Saves accounts, tracks, favorites, and other long-term data |
| Redis and Bull | Keeps sign-in sessions and manages background work |
| Amazon S3 / SeaweedFS | Stores private audio and images in production / locally |
| Python, librosa, and FFmpeg | Reads audio files and analyzes BPM and musical key |
| Docker, Terraform, and GitHub Actions | Supports local setup, AWS infrastructure, testing, and deployment |

## Run it locally

> **Recommended:** use Docker. It starts the API and everything it needs. You
> do not need to install PostgreSQL, Redis, Python, or FFmpeg yourself.

> **About the URLs in this guide:** every local URL below is a default from
> [`.env.example`](.env.example). If you change a local port, use your new value
> instead. The configuration table after step 5 shows exactly what to update.

### 1. Install the two requirements

- [Git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker
  Engine with Compose)

Make sure Docker is open and running before continuing.

### 2. Download the project

```bash
git clone https://github.com/christianvieux/trackfusionweb-api.git
cd trackfusionweb-api
```

If you already downloaded the project, open a terminal in its folder and skip
this step.

### 3. Create your local settings file

If an `.env` file already exists, keep it and skip this command.

```bash
cp .env.example .env
```

Open `.env` and replace the example values for these three settings:

```dotenv
SESSION_SECRET=use_a_long_random_value_here
JWT_SECRET=use_a_different_long_random_value_here
POSTGRES_PASSWORD=choose_a_local_database_password
```

Use at least 32 random characters for each secret. These values are only for
your computer and must not be committed to Git. When using Docker, leave the
other settings at their defaults.

### 4. Start the API

```bash
docker compose up -d --build
```

This builds the API, starts all local services in the background, and prepares
the database automatically. The first start can take a few minutes.

### 5. View the API

With the default settings, open
[http://127.0.0.1:8081/health](http://127.0.0.1:8081/health). A working API
returns:

```json
{"status":"healthy"}
```

The API does not have a visual home page. Opening only the API address may show
`Cannot GET /`; that is normal. Use `/health`, connect the TrackFusionWeb App,
or request another endpoint.

## Local URLs and configuration

The addresses in this table assume `.env` still has its example values.

| Default local address | What it is for | Setting that changes it |
| --- | --- | --- |
| `http://127.0.0.1:8081/health` | Confirms that the API is running | `LOCAL_API_PORT` |
| `http://127.0.0.1:8081/tracks/public` | Returns public tracks as JSON | `LOCAL_API_PORT` |
| `http://127.0.0.1:9000` | Serves signed local audio and image URLs | `LOCAL_STORAGE_PORT` |
| `http://127.0.0.1:8025` | Shows local verification and password-reset emails | `LOCAL_MAILPIT_UI_PORT` |

Local emails are captured by Mailpit; they are not sent to a real address.

Keep these settings aligned when either project uses a custom port or URL:

| Connection | App setting | API setting |
| --- | --- | --- |
| App calls the API | `NEXT_PUBLIC_API_URL` | `LOCAL_API_PORT` |
| API accepts the App | `NEXT_PUBLIC_SITE_URL` and the App's actual browser address | `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, and `DEV_URLS` |
| App displays local media | `NEXT_IMAGE_REMOTE_ORIGINS` | `LOCAL_STORAGE_PORT` |

For example, if `LOCAL_API_PORT=8181`, set
`NEXT_PUBLIC_API_URL=http://localhost:8181` in the App. If you keep the
defaults, no coordination is needed.

## Common commands

Run these commands from the API folder.

| Command | What it does |
| --- | --- |
| `docker compose up -d` | Starts the existing local setup in the background |
| `docker compose up -d --build` | Rebuilds the API and starts it; use this after code or package changes |
| `docker compose ps` | Shows which services are running and whether they are healthy |
| `docker compose logs -f api` | Shows live API messages; press `Ctrl+C` to stop viewing the messages |
| `docker compose restart api` | Restarts only the API |
| `docker compose down` | Stops the project and keeps your local data |

> **Data reset — use with care:** `docker compose down -v` stops the project
> and permanently deletes its local database, uploaded files, and captured
> emails. Most people should use `docker compose down` instead.

## Troubleshooting

### The health link does not open

Open `/health` on the API address configured by `LOCAL_API_PORT`. Then check the
services and read the API messages:

```bash
docker compose ps
docker compose logs api
```

If a service shows `unhealthy` or `exited`, rebuild and start the setup again:

```bash
docker compose up -d --build
```

### Docker says a required value is missing

Make sure `.env` exists in the API folder and that `POSTGRES_PASSWORD` has a
value. If the file is missing, repeat step 3 above. Do not overwrite an existing
`.env` file unless you intend to replace your local settings.

### A port is already in use

The defaults are API `8081`, storage `9000`, Mailpit inbox `8025`, and Mailpit
SMTP `1025`. Change the corresponding setting in `.env`:

```dotenv
LOCAL_API_PORT=8081
LOCAL_STORAGE_PORT=9000
LOCAL_MAILPIT_UI_PORT=8025
LOCAL_MAILPIT_SMTP_PORT=1025
```

Then recreate the affected containers:

```bash
docker compose up -d --force-recreate
```

When `LOCAL_API_PORT` changes, update the App's `NEXT_PUBLIC_API_URL`.
When `LOCAL_STORAGE_PORT` changes, update the App's
`NEXT_IMAGE_REMOTE_ORIGINS` to the exact origin, such as
`http://127.0.0.1:9100`. The API automatically signs local media URLs with
the configured storage port.

### Sign-up or password-reset emails do not arrive

This is expected locally. Open Mailpit using `LOCAL_MAILPIT_UI_PORT`. With the
default setting, its address is
[http://127.0.0.1:8025](http://127.0.0.1:8025).

### Old local data is causing errors

First try a normal restart. If you are certain that you do not need any local
accounts, tracks, files, or emails, reset the local setup:

```bash
docker compose down -v
docker compose up -d --build
```

The first command permanently deletes all local project data.

## How the local setup fits together

```text
TrackFusionWeb App
   |
   v
TrackFusionWeb API ---- PostgreSQL   saved users, tracks, and favorites
         |\---------- Redis         sign-in sessions and background work
         |\---------- SeaweedFS     local audio and image storage
          \---------- Mailpit       local email inbox
```

Docker starts and connects these services for you. The local services use test
data only and do not require an AWS or email-provider account.

## API overview

Requests and responses use JSON unless an endpoint returns a file. Routes that
change private user data require a signed-in session.

| Area | Example routes |
| --- | --- |
| Health | `GET /health` |
| Accounts | `POST /users/register`, `GET /users/info/:userId` |
| Sign-in | `POST /auth/login`, `POST /auth/logout`, `GET /auth/session` |
| Tracks | `GET /tracks/public`, `GET /tracks/user`, `PUT /tracks/:id` |
| Favorites | `GET /tracks/favorites`, `POST /tracks/favorites` |
| Uploads | `POST /aws/presigned-url`, `POST /upload/track` |
| Audio analysis | `POST /audio/analyze`, `GET /audio/analysis-status/:jobId` |

Uploads and audio analysis run in the background. The API returns a job ID that
the App uses to check progress.

## Tests and project checks

> This section is for contributors. You do not need these commands just to run
> and view the API. Install Node.js 22 or newer before using them.

```bash
npm ci
npm test -- --runInBand
npm run smoke
docker compose exec -T api node scripts/verifyDatabase.js
```

| Command | What it checks |
| --- | --- |
| `npm ci` | Installs the exact package versions recorded by the project |
| `npm test -- --runInBand` | Runs the automated tests one at a time |
| `npm run smoke` | Makes safe requests to the API at `LOCAL_API_PORT` to confirm it responds correctly |
| `verifyDatabase.js` | Confirms that the local database has the expected structure |

GitHub Actions also runs the test suite, dependency audit, database checks,
Docker build, and infrastructure checks on pushes and pull requests.

## Advanced configuration and deployment

> Most contributors should keep the Docker and `.env.example` defaults. This
> section is only a high-level reference for production work.

Production runs behind Nginx on AWS EC2, stores private media in Amazon S3, and
uses PostgreSQL and Redis. Terraform defines the AWS resources, and GitHub
Actions deploys through short-lived AWS access instead of stored AWS keys.

- Infrastructure definitions: [`infrastructure/terraform/`](infrastructure/terraform/)
- Server and Nginx configuration: [`deploy/`](deploy/)
- Local setting descriptions: [`.env.example`](.env.example)

Running without Docker is possible, but it requires manually installing and
configuring PostgreSQL, Redis, Python 3.12, FFmpeg, object storage, and a local
email server. Docker is the supported and recommended setup for local work.

## Security highlights

- Passwords and time-limited account tokens are stored as secure hashes.
- Sign-in cookies are HTTP-only and use stricter settings in production.
- Private media is accessed through short-lived links rather than public files.
- Production secrets are kept outside the repository.
- AWS access uses roles and short-lived credentials instead of committed keys.

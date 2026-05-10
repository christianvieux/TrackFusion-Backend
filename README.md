# TrackFusionWeb - Backend

This is the **server** part of TrackFusionWeb, a web application for music sharing. This API handles all the important tasks like storing user information, managing music details, and processing requests from the website. While users interact with the website interface, this server does the heavy lifting by talking to the database and making sure everything works smoothly.

## What it Does

**Key Features:**

- **User Management**: sign up, login, profiles
- **Music Management**: uploads and storage
- **Security**: email verification
- **Interaction**: track commenting
- ~~**Playlist System**: creation and sharing~~
- ~~**Search Engine**: song search and discovery~~
- ~~**Social Features**: user following system~~

## Technology Stack

- **Node.js**: Server runtime environment
- **Express.js**: Web application framework
- **PostgreSQL**: Relational database
- **Redis**: Session management and caching
- **AWS Services**:
  - **S3**: Cloud storage for audio files
  - **IAM**: Access management
  - ~~**Secrets Manager**: Secure configuration~~
- **JWT**: Authentication and authorization
- ~~**Mailgun**: Email service for notifications~~

## Prerequisites

**Required Software:**

- **Node.js** >= 16.x
- **PostgreSQL** >= 14.x
- **AWS Account**

**Required Knowledge:**

- **Backend Development**: Node.js and Express
- **Database**: SQL and database management
- **Cloud Services**: AWS fundamentals, especially S3 and IAM

## Project Setup

> 🚀 **Before You Dive In**:
>
> This backend needs a few technical services to work its magic: AWS for cloud storage, PostgreSQL for data, and Redis for speed.
>
> Think of it like building IKEA furniture. You'll need the right tools, patience, and maybe a small emotional breakdown. So you've been warned :P

### 1. AWS Configuration

> **Note**: Keep everything you create in the same AWS region. Otherwise you're going to run into annoying issues that make zero sense at first.

#### Create an IAM User

1. Log into the AWS Console
2. Go to the IAM service
3. Create a new user with programmatic access
4. Attach these policies:
   - `AmazonS3FullAccess`
   - `SecretsManagerReadWrite`
5. Create and save the **Access Key ID** and **Secret Access Key**

#### Create an S3 Bucket

1. Create a new S3 bucket for storing audio files
2. Enable the proper CORS settings
3. Save the bucket name

### 2. Database Setup

The project uses PostgreSQL for data storage.

#### Install PostgreSQL

Install PostgreSQL version `14.x` or newer.

#### Create Database

In this example, the database is called:

```sql
CREATE DATABASE trackfusionweb_db;
````

#### Initialize Your Database with Important Data

The SQL file should be located in this project folder:

```txt
init_database.sql
```

You can initialize the database in one of two ways:

```bash
# Option 1: Using psql
# Replace 'your_username' with your PostgreSQL username

psql -U your_username -d trackfusionweb_db -f init_database.sql
```

Or using pgAdmin:

```txt
Open pgAdmin
Select Database
Open Query Tool
Open init_database.sql
Execute
```

### 3. Environment Configuration

> **Note:** Use `NODE_ENV=development` for local development. Use `NODE_ENV=production` only when deploying the API in a production environment.

Create your `.env` file with these configurations:

```env
# Environment
NODE_ENV=development

# AWS Configuration
AWS_REGION=your-region
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name

# Security
CORS_ALLOWED_ORIGINS="http://localhost:3001,http://localhost:3000"
SESSION_SECRET=your-long-random-string
JWT_SECRET=another-random-string
JWT_SECRET_PASSWORD_RESET=different-random-string

# Database
DATABASE_URL="postgres://username:password@localhost:5432/trackfusionweb_db"

# Server
PORT=3000
DOMAIN=localhost

# Email
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_DOMAIN=your-domain
MAILGUN_FROM_EMAIL="Your App <noreply@yourdomain.com>"

# Media Settings
AUDIO_MAX_LENGTH=900
AUDIO_MAX_FILE_SIZE=300
IMAGE_MAX_FILE_SIZE=50

# File Type Restrictions
ALLOWED_AUDIO_TYPES=audio/mp3,audio/wav,audio/mpeg,audio/ogg
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/heic
```

### Production HTTPS / Cookie Setup

When the frontend is served over HTTPS, the API should also be reachable through HTTPS.

The Node/Express server can still run with plain HTTP internally if Nginx handles HTTPS in front of it.

Use production-style environment values like:

```env
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

Only set this if you intentionally need cookies shared across subdomains:

```env
COOKIE_DOMAIN=.your-domain.com
```

If your frontend and API are on the same registrable site, such as:

```txt
https://your-domain.com
https://api.your-domain.com
```

then `COOKIE_SAME_SITE=lax` is usually preferred.

If they are on different sites, such as a Vercel domain calling a separate API domain, use:

```env
COOKIE_SAME_SITE=none
COOKIE_SECURE=true
```

### Production Nginx + HTTPS Setup

In production, this API should not be accessed directly through the raw EC2 public IP or through a public `:3000` port.

Instead, the API should be reached through a real HTTPS domain.

Example:

```txt
https://your-api-domain.com
```

This can be either a main domain or a subdomain, depending on how you want to deploy it.

Examples:

```txt
https://your-domain.com
https://api.your-domain.com
https://backend.your-domain.com
```

The Express server still runs normally on the EC2 instance using plain HTTP:

```txt
http://localhost:3000
```

Nginx sits in front of Express and acts as the public entry point. It receives traffic from the browser, handles HTTPS with the SSL certificate, then forwards the request to the local Express server.

```txt
Browser
  ↓
https://your-api-domain.com
  ↓
Nginx
  ↓
http://localhost:3000
  ↓
Express API
```

This is needed because browsers expect the API to use HTTPS when the frontend is also served over HTTPS. If the frontend is HTTPS but the API is HTTP, browsers may block requests, cookies may fail, and the app can break in production.

#### Why Nginx is Used

Nginx is the public-facing web server / reverse proxy.

It handles:

```txt
HTTPS traffic
SSL certificate routing
Forwarding requests to Express
Keeping Express private behind localhost
```

Express handles the actual API logic.

Nginx handles the public web traffic.

This keeps the backend setup cleaner and safer because port `3000` does not need to be publicly exposed.

#### Production API Domain

Use a real domain for the API.

Example:

```txt
your-api-domain.com
```

This can be a main domain or a subdomain.

DNS should point this domain to the EC2 public IP using an `A` record.

Example if using a main domain:

```txt
Type: A
Name: @
Value: EC2_PUBLIC_IP
```

Example if using a subdomain:

```txt
Type: A
Name: api
Value: EC2_PUBLIC_IP
```

Do not use the EC2 private IP for DNS. The private IP usually looks like this:

```txt
172.x.x.x
```

The DNS record needs the public EC2 IP.

#### EC2 Security Group

The EC2 security group should allow:

```txt
22    SSH      only from trusted IPs if possible
80    HTTP     0.0.0.0/0
443   HTTPS    0.0.0.0/0
```

Port `3000` should not be publicly exposed unless there is a specific reason.

Nginx should be public.

Express should stay private on:

```txt
localhost:3000
```

#### Nginx File Locations

The active Nginx config should live here:

```txt
/etc/nginx/sites-available/trackfusionweb-api
```

The enabled site is a symlink here:

```txt
/etc/nginx/sites-enabled/trackfusionweb-api
```

This is the normal Ubuntu Nginx structure:

```txt
sites-available = configs that exist
sites-enabled   = configs that are turned on
```

#### Nginx Config

Create or edit the config file:

```bash
sudo nano /etc/nginx/sites-available/trackfusionweb-api
```

Base config before HTTPS:

```nginx
# TrackFusion Web API
# Public URL: https://your-api-domain.com
# Proxies to Express running locally on port 3000

server {
    listen 80;
    server_name your-api-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Replace `your-api-domain.com` with the real domain being used for the API.

Enable the config:

```bash
sudo ln -s /etc/nginx/sites-available/trackfusionweb-api /etc/nginx/sites-enabled/trackfusionweb-api
```

If the symlink already exists, do not create it again. Just test and reload Nginx.

Test the Nginx config:

```bash
sudo nginx -t
```

Reload Nginx:

```bash
sudo systemctl reload nginx
```

#### Test Express Locally

Before testing the public domain, make sure Express works locally on the EC2 instance:

```bash
curl http://localhost:3000/health
```

Expected result should show the API health status.

#### Test HTTP First

Before setting up HTTPS, test the public HTTP version:

```bash
curl http://your-api-domain.com/health
```

This confirms:

```txt
DNS → EC2 → Nginx → Express
```

If HTTP does not work, fix that before touching Certbot. Otherwise you’ll be debugging two demons at once.

#### Install Certbot

Certbot is used to create and renew the SSL certificate.

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

#### Add HTTPS Certificate

Run:

```bash
sudo certbot --nginx -d your-api-domain.com
```

When Certbot asks whether to redirect HTTP to HTTPS, choose the redirect option.

After this, the API should be available at:

```txt
https://your-api-domain.com
```

Test it:

```bash
curl https://your-api-domain.com/health
```

#### Certificate Auto-Renewal

Check the current certificate:

```bash
sudo certbot certificates
```

Test renewal:

```bash
sudo certbot renew --dry-run
```

A good result looks like:

```txt
Congratulations, all simulated renewals succeeded
```

Check that the renewal timer exists:

```bash
systemctl list-timers | grep certbot
```

A good result should show something like:

```txt
certbot.timer    certbot.service
```

This means Certbot has an automatic renewal timer set up.

#### Important Renewal Notes

Auto-renewal should keep working as long as:

```txt
your-api-domain.com still points to this EC2 instance
ports 80 and 443 stay open
Nginx config stays valid
certbot.timer stays enabled
the EC2 instance stays active
```

Do not close port `80`, even if HTTP redirects to HTTPS. Certbot may still need it for renewal checks.

#### Useful Nginx / Certbot Commands

```bash
sudo systemctl status nginx
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certificates
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
curl http://localhost:3000/health
curl https://your-api-domain.com/health
```

#### Frontend API URL

The frontend should use the HTTPS API domain:

```env
NEXT_PUBLIC_API_URL=https://your-api-domain.com
```

After changing frontend environment values, rebuild and restart the frontend if it is running as a production Next.js build.

### 4. Install Dependencies

```bash
npm install
```

### 5. Redis Setup

#### Install Redis

```bash
sudo apt update
sudo apt install redis-server
```

#### Start Redis

```bash
sudo systemctl start redis-server
```

#### Verify Installation

```bash
redis-cli ping
```

If you see:

```txt
PONG
```

Redis is running correctly.

### 6. Start The Server

```bash
npm start
```

### 7. Verify Setup

Check this endpoint to verify your setup:

```txt
http://localhost:3000/health
```

For production:

```txt
https://your-api-domain.com/health
```

## Troubleshooting

If you encounter issues:

1. Verify all environment variables are set correctly
2. Ensure PostgreSQL is running and accessible
3. Confirm Redis server is active
4. Check AWS credentials and permissions
5. Verify network connectivity and CORS settings
6. Check that Nginx config is valid with `sudo nginx -t`
7. Check that Certbot renewal works with `sudo certbot renew --dry-run`
8. Make sure the API domain points to the EC2 public IP
9. Make sure ports `80` and `443` are open in the EC2 security group
10. Light a candle, draw a circle with chalk, and chant "npm install" three times. Results may vary.

> **Just know:** This wasn't built with public usage in mind. If none of these steps work and you really want to get this working, just shoot me an email at [christianvieux.dev@gmail.com](mailto:christianvieux.dev@gmail.com). I usually respond quickly and can help sort things out.

## API Endpoints

### Authentication Routes

* POST `/auth/register` - Create new account
* POST `/auth/login` - User login
* POST `/auth/logout` - User logout
* GET `/auth/verify-email/:token` - Verify email address

### User Routes

* GET `/users/me` - Get current user profile
* GET `/users/:id` - Get user by ID
* PUT `/users/me` - Update current user
* GET `/users/:id/tracks` - Get user's public tracks
* GET `/users/:id/favorites` - Get user's favorite tracks

### Track Routes

* GET `/tracks` - Get all tracks
* GET `/tracks/:id` - Get track by ID
* POST `/tracks` - Upload new track
* PUT `/tracks/:id` - Update track
* DELETE `/tracks/:id` - Delete track
* POST `/tracks/:id/like` - Like/unlike track
* POST `/tracks/:id/comments` - Add comment

### Upload Routes

* POST `/upload/track` - Upload track file
* GET `/upload/track-status/:jobId` - Check upload status

### Health Check

* GET `/health` - API health status

## Contact

Feel free to reach out if you have any questions about my project:

* Email: [christianvieux.dev@gmail.com](mailto:christianvieux.dev@gmail.com)
* LinkedIn: [https://www.linkedin.com/in/christian-vieux-dev/](https://www.linkedin.com/in/christian-vieux-dev/)
* GitHub: [https://github.com/christianvieux](https://github.com/christianvieux)


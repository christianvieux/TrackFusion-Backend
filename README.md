# TrackFusionWeb - Backend

This is the **server** part of Trackfusionweb, a web application for music sharing. This API handles all the important tasks like storing user information, managing music details, and processing requests from the website. While users interact with the nice-looking website interface, this server does all the heavy lifting by talking to the database and ensuring everything works smoothly.

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
- **Cloud Services**: AWS fundamentals (S3, IAM)

## Project Setup

> 🚀 **Before You Dive In**:
>
> This backend needs a few technical services to work its magic (AWS for cloud storage, PostgreSQL for data, and Redis for speed). Think of it like building IKEA furniture - you'll need the right tools and a bit of patience. And just like that one IKEA shelf that made you question your life choices, the setup might make you scratch your head a few times. So you've been warned :P

### 1. AWS Configuration

- > **Note**: please keep everything you create in the same region. Otherwise you're going to run into some issues.

1. **Create an IAM User**

   - Log into AWS Console
   - Go to IAM Service
   - Create a new user with programmatic access
   - Attach these policies:
     - `AmazonS3FullAccess`
     - `SecretsManagerReadWrite`
   - Then create an **Access Key** for that user you just created. Save the **Access Key ID** and **Secret Access Key**

2. **Create S3 Bucket**
   - Create a new S3 bucket for storing audio files
   - Enable appropriate CORS settings
   - Note down the bucket name

### 2. Database Setup

The project uses PostgreSQL for data storage:

1. **Install PostgreSQL** (≥ 14.x)
2. **Create Database** (in this example i'm using 'trackfusionweb_db' )
   ```sql
   CREATE DATABASE trackfusionweb_db;
   ```
3. **Initialize Your Database with important Data**

   > The database sql file should is be located in this project folder called `init_database.sql`.

   ```bash
   # You can do this two ways:

   # 1. Execute the SQL schema using psql. Replace 'your_username' with your PostgreSQL username
      psql -U your_username -d trackfusionweb_db -f init_database.sql

   # 2. Or using pgAdmin Open pgAdmin > Select Database > Query Tool > Open init_database.sql > Execute
   ```

### 3. Environment Configuration

> **Note:** Keep the `NODE_ENV` value as 'development'. Do not use anything else.

Create your `.env` file with these configurations (examples shown):

```env
# Environment
NODE_ENV=development

# AWS Configuration
AWS_REGION=your-region                # e.g., us-east-1
AWS_ACCESS_KEY_ID=your-access-key     # From IAM user
AWS_SECRET_ACCESS_KEY=your-secret-key # From IAM user
AWS_S3_BUCKET=your-bucket-name        # Your S3 bucket name

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

# Email (Optional - for notifications)
MAILGUN_API_KEY=your-mailgun-key
MAILGUN_DOMAIN=your-domain
MAILGUN_FROM_EMAIL="Your App <noreply@yourdomain.com>"

# Media Settings
AUDIO_MAX_LENGTH=900         # 15 minutes
AUDIO_MAX_FILE_SIZE=300      # 300 MB
IMAGE_MAX_FILE_SIZE=50       # 50 MB

# File Type Restrictions
ALLOWED_AUDIO_TYPES=audio/mp3,audio/wav,audio/mpeg,audio/ogg
ALLOWED_IMAGE_TYPES=image/jpeg,image/png,image/heic
```

### 4. Install Dependencies

```bash
npm install
```
### 5. Redis Setup
   1. **Install Redis**
      ```bash
      sudo apt update
      sudo apt install redis-server
      ```

   2. **Start Redis**
      ```bash
      sudo systemctl start redis-server
      ```

   3. **Verify Installation**
      ```bash
      redis-cli ping
      ```
      If you see `PONG`, Redis is running correctly.

### 6. Start The Server

   ```bash
   npm start
   ```

### 7. Verify Setup

Check this endpoint to verify your setup:

- Health check: `http://localhost:3000/api/health`

## Troubleshooting

If you encounter issues:

1. Verify all environment variables are set correctly
2. Ensure PostgreSQL is running and accessible
3. Confirm Redis server is active
4. Check AWS credentials and permissions
5. Verify network connectivity and CORS settings
6. Light a candle, draw a circle with chalk, and chant "npm install" three times (results may vary)

> **Just know:** This wasn't built with public usage in mind. If none of these steps work and you really want to get this working, just shoot me an email at christianvieux.dev@gmail.com. I usually respond quickly and can help sort things out.

## API Endpoints

### Authentication Routes

- POST `/api/auth/register` - Create new account
- POST `/api/auth/login` - User login
- POST `/api/auth/logout` - User logout
- GET `/api/auth/verify-email/:token` - Verify email address

### User Routes

- GET `/api/users/me` - Get current user profile
- GET `/api/users/:id` - Get user by ID
- PUT `/api/users/me` - Update current user
- GET `/api/users/:id/tracks` - Get user's public tracks
- GET `/api/users/:id/favorites` - Get user's favorite tracks

### Track Routes

- GET `/api/tracks` - Get all tracks
- GET `/api/tracks/:id` - Get track by ID
- POST `/api/tracks` - Upload new track
- PUT `/api/tracks/:id` - Update track
- DELETE `/api/tracks/:id` - Delete track
- POST `/api/tracks/:id/like` - Like/unlike track
- POST `/api/tracks/:id/comments` - Add comment


### Upload Routes

- POST `/api/upload/track` - Upload track file
- GET `/api/upload/track-status/:jobId` - Check upload status

### Health Check

- GET `/api/health` - API health status

## Contact

Feel free to reach out if you have any questions about my project:

- Email: christianvieux.dev@gmail.com
- LinkedIn: https://www.linkedin.com/in/christian-vieux-dev/
- GitHub: https://github.com/christianvieux

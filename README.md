# TrackFusion Backend

> **Important Notice:** This repository's main branch is no longer actively maintained. The updated and current version of this code has been migrated to AWS and can be found in the `app-runner-setup` branch. The code in this branch may not work as expected and is no longer being developed.

A Node.js backend for TrackFusion, a web application that lets users discover and share music. This project demonstrates fundamental web development concepts including server setup, routing, and database operations.

## About This Project
I built this backend as part of my journey learning web development. It handles basic music platform operations like user management and music track information storage. The project showcases my understanding of:
- Building a REST API with Express.js
- Working with databases using PostgreSQL
- Implementing user authentication
- Writing clean, maintainable code
- Following MVC (Model-View-Controller) architecture

## Technology Stack
- Node.js
- Express.js
- PostgreSQL
- JWT for authentication

## Features
- User registration and login
- Music track information storage
- Basic user profile management
- Simple search functionality

## Prerequisites
- Node.js >= 16.x
- PostgreSQL >= 14.x

## Project Setup
1. **Clone the Repository**
   ```bash
   git clone https://github.com/christianvieux/TrackFusion-Backend.git
   cd trackfusion-backend
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Set Up Environment Variables**
   I've included a `.env.example` file to help you get started with the required environment variables. Simply copy this file and rename it to `.env`:
   ```bash
   cp .env.example .env
   ```
   Then open the `.env` file and replace the placeholder values with your actual configuration:
   ```
   PORT=3000
   DB_CONNECTION=your_database_connection_string
   JWT_SECRET=your_secret_key
   ```
   The .env.example file serves as a template and helps other developers understand which environment variables are needed to run the project.

4. **Start the Server**
   ```bash
   npm start
   ```

## Database Structure
The project uses a PostgreSQL database with the following main tables:
- Users: Stores user information
- Tracks: Stores music track details
- Playlists: Manages user playlist data

## API Endpoints
### User Routes
- POST /api/users/register - Create new user account
- POST /api/users/login - User login
- GET /api/users/profile - Get user profile

### Music Routes
- GET /api/tracks - Get all tracks
- GET /api/tracks/:id - Get specific track
- POST /api/tracks - Add new track
- GET /api/playlists - Get user playlists

## Contact
Feel free to reach out if you have any questions about my project:
- Email: christianvieux.dev@gmail.com
- LinkedIn: https://www.linkedin.com/in/christian-vieux-dev/
- GitHub: https://github.com/christianvieux

---
This project was created as part of my web development portfolio to demonstrate my backend development skills. While it shows my understanding of fundamental web development concepts and ability to create functional web applications, please note that active development has moved to the AWS-based version in the app-runner branch.

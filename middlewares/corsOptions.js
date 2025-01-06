import dotenv from 'dotenv';
dotenv.config();

// Load the environment variable
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS ? process.env.CORS_ALLOWED_ORIGINS.split(',') : [];

export const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true); // Allow the request
    } else {
      callback(new Error(`Not allowed by CORS - ${origin}`)); // Deny the request
    }
  },
  credentials: true, // Allow credentials (cookies, authorization headers)
};

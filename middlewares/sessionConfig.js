// sessionConfig.js
import dotenv from "dotenv";
dotenv.config();

export default {
  secret: process.env.SESSION_SECRET || "your-secret-key",
  resave: false,
  saveUninitialized: false,
  name: 'sessionId',
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // Increase to 24 hours
    path: '/',
    domain: process.env.DOMAIN || undefined
  },
};

// sessionConfig.js
import dotenv from "dotenv";
dotenv.config();

export default {
  secret: process.env.SESSION_SECRET || "your-secret-key",
  resave: false,
  saveUninitialized: false,
  name: 'sessionId',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 60 * 60000,
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? process.env.DOMAIN : undefined
  },
};

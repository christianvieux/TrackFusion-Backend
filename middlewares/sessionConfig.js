// sessionConfig.js
import dotenv from "dotenv";
import { sessionCookieOptions } from "../utils/cookieOptions.js";
dotenv.config();

export default {
  secret: process.env.SESSION_SECRET || "your-secret-key",
  resave: false,
  saveUninitialized: false,
  name: 'sessionId',
  proxy: process.env.NODE_ENV === "production",
  cookie: sessionCookieOptions,
};

//index.js
import dotenv from 'dotenv'; dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import session from 'express-session';
import cookieParser from 'cookie-parser';
import cors from "cors";
import helmet from 'helmet';
import http from 'http';
import rateLimit from 'express-rate-limit';

import { sendTestEmail } from './utils/emailUtils.js';
import { corsOptions } from './middlewares/corsOptions.js';
import sessionConfig from './middlewares/sessionConfig.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import trackRoutes from './routes/trackRoutes.js';
import otpRoutes from './routes/otpRoutes.js';
import enumRoutes from './routes/enumRoutes.js';
import audioRoutes from './routes/audioRoutes.js';
import publicRoutes from './routes/publicRoutes.js'
import { audioQueue, cleanupQueue } from "./services/audioServices.js";
import { errorHandler } from './middlewares/errorHandler.js';


const app = express();
const port = process.env.PORT || 3000;


// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});

// Secure middleware (order matters)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.set('trust proxy', 1); // If behind reverse proxy
app.use(limiter);
app.use(cookieParser());
app.use(session(sessionConfig));

// Basic middleware
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/public', publicRoutes)
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tracks', trackRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/enums', enumRoutes);
app.use('/api/audio', audioRoutes);

// Error handling
app.use(errorHandler);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Gracefully shutting down...');
  await Promise.all([
    audioQueue.close(),
    cleanupQueue.close()
  ]);
  process.exit(0);
});

// Log unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

const server = http.createServer(app); // Create an HTTP server
// Server timeout
server.timeout = 30000; // 30 seconds
// Start the server
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
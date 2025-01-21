//index.js
import dotenv from "dotenv";
dotenv.config();
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

// function to load secrets from Secrets Manager
async function loadSecrets() {
  console.log('Starting secrets loading process...');
  console.log('Current environment:', process.env.NODE_ENV);

  if (process.env.NODE_ENV === "development") {
    // In development, use dotenv as usual
    console.log("Using local .env file");
    const dotenv = await import("dotenv");
    dotenv.config();
  } else {
    console.log("Attempting to load secrets from AWS Secrets Manager");
    // In production (App Runner), load from Secrets Manager
    const client = new SecretsManagerClient();
    const command = new GetSecretValueCommand({
      SecretId: "/tfweb/dev/env-variables",
    });

    try {
      const response = await client.send(command);
      console.log("Successfully fetched secrets from AWS");
      const secrets = JSON.parse(response.SecretString);

      // Set environment variables from secrets
      Object.keys(secrets).forEach((key) => {
        process.env[key] = secrets[key];
      });
    } catch (error) {
      console.error("Failed to load secrets:", error);
      throw error;
    }
  }
  console.log("Environment variables loaded successfully");
}

// Load secrets before importing other modules
await loadSecrets();

import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import http from "http";
import rateLimit from "express-rate-limit";

import { sendTestEmail } from "./utils/emailUtils.js";
import { corsOptions } from "./middlewares/corsOptions.js";
import sessionConfig from "./middlewares/sessionConfig.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import trackRoutes from "./routes/trackRoutes.js";
import otpRoutes from "./routes/otpRoutes.js";
import enumRoutes from "./routes/enumRoutes.js";
import audioRoutes from "./routes/audioRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import { audioQueue, cleanupQueue } from "./services/audioServices.js";
import { errorHandler } from "./middlewares/errorHandler.js";

const app = express();
const port = process.env.PORT || 8080;

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Secure middleware (order matters)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.set("trust proxy", 1); // If behind reverse proxy
app.use(limiter);
app.use(cookieParser());
app.use(session(sessionConfig));

// Basic middleware
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

// Routes
app.use("/api/public", publicRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/tracks", trackRoutes);
app.use("/api/otp", otpRoutes);
app.use("/api/enums", enumRoutes);
app.use("/api/audio", audioRoutes);

// Health check for load balancer
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

// Error handling
app.use(errorHandler);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Gracefully shutting down...");

  // Close server first
  server.close(async () => {
    console.log("Server closed");

    // Then close queues
    await Promise.all([audioQueue.close(), cleanupQueue.close()]);

    process.exit(0);
  });

  // Force close after timeout
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 30000);
});

// Log unhandled rejections
process.on("unhandledRejection", (error) => {
  console.error("Unhandled rejection:", error);
});

const server = http.createServer(app); // Create an HTTP server
// Server timeout
server.timeout = 120000; // 2 minutes
// Start the server
server.listen(port, "0.0.0.0", () => {
  console.log(
    `Server running on port ${port}, bound to all network interfaces`
  );
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`deployment version 1.0.0`);
});

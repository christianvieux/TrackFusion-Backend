import dotenv from "dotenv";
import { initializeEnvironment, validateEnvironment } from "./utils/loadEnv.js";

dotenv.config();

async function startServer() {
  await initializeEnvironment();
  const { port } = validateEnvironment();

  const http = (await import("http")).default;
  const express = (await import("express")).default;
  const session = (await import("express-session")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const cors = (await import("cors")).default;
  const helmet = (await import("helmet")).default;
  const { createClient } = await import("redis");
  const { RedisStore } = await import("connect-redis");
  const { default: databasePool, verifyDatabaseConnection } = await import("./services/dbService.js");

  await verifyDatabaseConnection();
  console.log("PostgreSQL connection verified");

  const redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on("error", (error) => {
    console.error("Redis client error:", error.message);
  });
  await redisClient.connect();
  console.log("Redis connection verified");

  const { corsOptions } = await import("./middlewares/corsOptions.js");
  const { default: sessionConfig } = await import("./middlewares/sessionConfig.js");
  const { apiLimiter } = await import("./middlewares/limiterConfig.js");
  const { default: authRoutes } = await import("./routes/authRoutes.js");
  const { default: userRoutes } = await import("./routes/userRoutes.js");
  const { default: trackRoutes } = await import("./routes/trackRoutes.js");
  const { default: otpRoutes } = await import("./routes/otpRoutes.js");
  const { default: enumRoutes } = await import("./routes/enumRoutes.js");
  const { default: audioRoutes } = await import("./routes/audioRoutes.js");
  const { default: publicRoutes } = await import("./routes/publicRoutes.js");
  const { default: awsRoutes } = await import("./routes/awsRoutes.js");
  const { default: uploadRoutes } = await import("./routes/uploadRoutes.js");
  const { audioQueue, cleanupQueue, audioAnalysisQueue } = await import("./queue/audioQueue.js");
  const { trackUploadQueue, profilePictureUploadQueue } = await import("./queue/uploadQueue.js");
  const { errorHandler } = await import("./middlewares/errorHandler.js");

  const app = express();
  const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || "1mb";

  app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
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
    }),
  );
  app.use(cors(corsOptions));
  app.use(apiLimiter);
  app.use(cookieParser());
  app.use(session({
    ...sessionConfig,
    store: new RedisStore({
      client: redisClient,
      prefix: "trackfusion:session:",
    }),
  }));
  app.use(express.json({ limit: requestBodyLimit }));
  app.use(express.urlencoded({ limit: requestBodyLimit, extended: true }));

  app.use("/public", publicRoutes);
  app.use("/auth", authRoutes);
  app.use("/users", userRoutes);
  app.use("/tracks", trackRoutes);
  app.use("/otp", otpRoutes);
  app.use("/enums", enumRoutes);
  app.use("/audio", audioRoutes);
  app.use("/aws", awsRoutes);
  app.use("/upload", uploadRoutes);

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "healthy" });
  });

  app.use(errorHandler);

  const server = http.createServer(app);
  server.timeout = 120000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, process.env.HOST, resolve);
  });

  console.log(`TrackFusion API listening on http://${process.env.HOST}:${port}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; shutting down gracefully`);

    await new Promise((resolve) => server.close(resolve));
    const resources = [
      audioQueue,
      cleanupQueue,
      audioAnalysisQueue,
      trackUploadQueue,
      profilePictureUploadQueue,
    ];
    await Promise.allSettled([
      ...resources.map((queue) => queue.close()),
      redisClient.quit(),
      databasePool.end(),
    ]);
    console.log("Shutdown complete");
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT").then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM").then(() => process.exit(0));
  });

  return { app, server };
}

startServer().catch((error) => {
  console.error("Unable to start TrackFusion API:", error);
  process.exit(1);
});

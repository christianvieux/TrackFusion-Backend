//index.js

// Essential imports first
import dotenv from "dotenv";
dotenv.config();

// Initialize environment before other imports
import { initializeEnvironment } from "./utils/loadEnv.js";
const fallbackPorts = [8080, 8081, 8082, 3000];

async function startServer() {
  const http = (await import("http")).default;
  const express = (await import("express")).default;
  const app = express();
  
  // Try different ports
  const tryPort = async (port) => {
    try {
      const server = http.createServer(app);
      await new Promise((resolve, reject) => {
        server
          .listen(port, "0.0.0.0")
          .once("listening", () => resolve(server))
          .once("error", (err) => {
            if (err.code === "EADDRINUSE") {
              server.close();
              reject(err);
            }
          });
      });
      const apiUrl = `http://localhost:${port}/api`;
      console.log(
        `🚀 Server successfully started - Listening on port ${port} (0.0.0.0)`
      );
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`API base URL: ${apiUrl}`);
      console.log(`deployment version 2.6.5`);
      return true;
    } catch (err) {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${port} in use, trying next port...`);
        return false;
      }
      throw err;
    }
  };

  try {
    // Load environment variables first
    try {
      await initializeEnvironment();
      console.log("Environment initialized successfully");
    } catch (error) {
      console.error("Environment initialization failed:", error);
      console.log("Continuing with default environment settings");
    }

    // Import other modules
    const bodyParser = (await import("body-parser")).default;
    const session = (await import("express-session")).default;
    const cookieParser = (await import("cookie-parser")).default;
    const cors = (await import("cors")).default;
    const helmet = (await import("helmet")).default;
    const rateLimit = (await import("express-rate-limit")).default;

    // Dynamic imports for routes and services
    const { corsOptions } = await import("./middlewares/corsOptions.js");
    const { default: sessionConfig } = await import(
      "./middlewares/sessionConfig.js"
    );
    const { default: authRoutes } = await import("./routes/authRoutes.js");
    const { default: userRoutes } = await import("./routes/userRoutes.js");
    const { default: trackRoutes } = await import("./routes/trackRoutes.js");
    const { default: otpRoutes } = await import("./routes/otpRoutes.js");
    const { default: enumRoutes } = await import("./routes/enumRoutes.js");
    const { default: audioRoutes } = await import("./routes/audioRoutes.js");
    const { default: publicRoutes } = await import("./routes/publicRoutes.js");
    const { sendTestEmail } = await import("./utils/emailUtils.js");
    const { audioQueue, cleanupQueue } = await import(
      "./services/audioServices.js"
    );
    const { errorHandler } = await import("./middlewares/errorHandler.js");

    // Rate limiter
    // const limiter = rateLimit({
    //   windowMs: 15 * 60 * 1000,
    //   max: 100,
    //   standardHeaders: true,
    //   legacyHeaders: false,
    // });

    app.set('trust proxy', 1); // trust first proxy
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
    app.use(cookieParser());
    // app.use(limiter);
    app.use(session(sessionConfig)); // session config

    // Basic cors middleware
    // app.use(cors(corsOptions));
    app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'sentry-trace', 'baggage', '*'],
      credentials: true
    }));

    // Increase body parser limits
    const size = "1000mb";
    app.use(express.json({ limit: size }));
    app.use(express.urlencoded({ limit: size, extended: true }));
    app.use(express.raw({ limit: size }));

    // Update body-parser limits
    app.use(bodyParser.json({ limit: size }));
    app.use(bodyParser.urlencoded({ limit: size, extended: true }));
    app.use(bodyParser.raw({ limit: size }));

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

    app.post('/test', (req, res) => {
      res.send('Success');
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
    for (const port of fallbackPorts) {
      if (await tryPort(port)) {
        break;
      }
    }
  } catch (error) {
    console.error("Critical server error:", error);
  }
}

startServer();
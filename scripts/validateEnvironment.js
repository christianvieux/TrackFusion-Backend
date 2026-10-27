import { initializeEnvironment, validateEnvironment } from "../utils/loadEnv.js";

try {
  if (!process.argv.includes("--local-only")) {
    await initializeEnvironment();
  }
  validateEnvironment();
  console.log("Production environment validation passed");
} catch (error) {
  console.error("Production environment validation failed:", error.message);
  process.exitCode = 1;
}

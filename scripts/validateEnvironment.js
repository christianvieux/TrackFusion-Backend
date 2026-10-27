import { initializeEnvironment, validateEnvironment } from "../utils/loadEnv.js";

try {
  await initializeEnvironment();
  validateEnvironment();
  console.log("Production environment validation passed");
} catch (error) {
  console.error("Production environment validation failed:", error.message);
  process.exitCode = 1;
}

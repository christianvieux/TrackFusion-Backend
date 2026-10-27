import dotenv from "dotenv";

dotenv.config();

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1_000;

function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

if (process.env.STORAGE_PROVIDER !== "s3-compatible") {
  console.log("Local storage initialization skipped for non-compatible provider");
  process.exit(0);
}

const { s3Service } = await import("../services/s3Service.js");

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  try {
    await s3Service.initializeBucket();
    if (!(await s3Service.testConnection())) {
      throw new Error("storage read/write check failed");
    }
    console.log("Local S3-compatible storage initialized successfully");
    process.exit(0);
  } catch (error) {
    if (attempt === MAX_ATTEMPTS) {
      console.error("Unable to initialize local object storage:", error.message);
      process.exit(1);
    }
    await delay(RETRY_DELAY_MS);
  }
}

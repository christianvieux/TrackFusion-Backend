import { validateEnvironment } from "./loadEnv.js";

const originalEnvironment = { ...process.env };

const validEnvironment = {
  NODE_ENV: "development",
  HOST: "127.0.0.1",
  PORT: "8081",
  REQUEST_BODY_LIMIT: "1mb",
  FRONTEND_URL: "http://localhost:3001",
  CORS_ALLOWED_ORIGINS: "http://localhost:3001",
  SESSION_SECRET: "test-session-secret",
  JWT_SECRET: "test-jwt-secret",
  JWT_SECRET_PASSWORD_RESET: "test-password-reset-secret",
  DATABASE_URL: "postgresql://user:password@localhost:5432/trackfusionweb_db",
  REDIS_URL: "redis://127.0.0.1:6379",
  PYTHON_EXECUTABLE: "venv/bin/python",
  AWS_REGION: "us-east-1",
  AWS_S3_BUCKET: "trackfusion-test-bucket",
  AUDIO_MAX_LENGTH: "900",
  AUDIO_MAX_FILE_SIZE: "300",
  IMAGE_MAX_FILE_SIZE: "50",
  ALLOWED_AUDIO_TYPES: "audio/mpeg,audio/wav",
  ALLOWED_IMAGE_TYPES: "image/jpeg,image/png",
  COOKIE_SECURE: "false",
  COOKIE_SAME_SITE: "lax",
  EMAIL_DELIVERY_ENABLED: "false",
  EMAIL_VALIDATE_MX: "false",
  EXPOSE_OTP_IN_DEVELOPMENT: "true",
  EXPOSE_RESET_TOKEN_IN_DEVELOPMENT: "true",
};

beforeEach(() => {
  process.env = { ...originalEnvironment, ...validEnvironment };
});

afterAll(() => {
  process.env = originalEnvironment;
});

test("returns a parsed port for valid configuration", () => {
  expect(validateEnvironment()).toEqual({ port: 8081 });
});

test("reports missing required variables together", () => {
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;

  expect(() => validateEnvironment()).toThrow(
    "Missing required environment variables: DATABASE_URL, REDIS_URL",
  );
});

test("rejects an invalid port", () => {
  process.env.PORT = "70000";

  expect(() => validateEnvironment()).toThrow(
    "PORT must be an integer between 1 and 65535",
  );
});

test("requires strong secrets in production", () => {
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "too-short";

  expect(() => validateEnvironment()).toThrow(
    "SESSION_SECRET must be at least 32 characters in production",
  );
});

test("allows production startup with email-dependent features disabled", () => {
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "s".repeat(32);
  process.env.JWT_SECRET = "j".repeat(32);
  process.env.JWT_SECRET_PASSWORD_RESET = "r".repeat(32);
  process.env.EMAIL_DELIVERY_ENABLED = "false";
  process.env.EXPOSE_OTP_IN_DEVELOPMENT = "false";
  process.env.EXPOSE_RESET_TOKEN_IN_DEVELOPMENT = "false";

  expect(validateEnvironment()).toEqual({ port: 8081 });
});

test("rejects malformed service URLs", () => {
  process.env.DATABASE_URL = "not-a-database-url";

  expect(() => validateEnvironment()).toThrow("DATABASE_URL must be a valid URL");
});

test("rejects invalid boolean values", () => {
  process.env.COOKIE_SECURE = "yes";

  expect(() => validateEnvironment()).toThrow("COOKIE_SECURE must be true or false");
});

test("requires a usable local email flow", () => {
  process.env.EMAIL_DELIVERY_ENABLED = "false";
  process.env.EXPOSE_OTP_IN_DEVELOPMENT = "false";

  expect(() => validateEnvironment()).toThrow(
    "Development without email delivery requires both development token exposure flags",
  );
});

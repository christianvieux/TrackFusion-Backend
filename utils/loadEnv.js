// utils/loadEnv.js

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export async function initializeEnvironment() {
  if (!process.env.AWS_SECRETS_ARN) {
    console.log("Using environment variables for application configuration");
    return;
  }

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const command = new GetSecretValueCommand({
    SecretId: process.env.AWS_SECRETS_ARN,
  });
  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error("The configured AWS secret does not contain a SecretString");
  }

  const secrets = JSON.parse(response.SecretString);

  // Explicit environment variables take precedence over values in Secrets Manager.
  Object.entries(secrets).forEach(([key, value]) => {
    if (process.env[key] === undefined) {
      process.env[key] = String(value);
    }
  });

  console.log("Loaded application configuration from AWS Secrets Manager");
}

const REQUIRED_ENVIRONMENT_VARIABLES = [
  "NODE_ENV",
  "HOST",
  "PORT",
  "REQUEST_BODY_LIMIT",
  "FRONTEND_URL",
  "CORS_ALLOWED_ORIGINS",
  "SESSION_SECRET",
  "JWT_SECRET",
  "JWT_SECRET_PASSWORD_RESET",
  "DATABASE_URL",
  "REDIS_URL",
  "PYTHON_EXECUTABLE",
  "AWS_REGION",
  "AWS_S3_BUCKET",
  "AUDIO_MAX_LENGTH",
  "AUDIO_MAX_FILE_SIZE",
  "IMAGE_MAX_FILE_SIZE",
  "ALLOWED_AUDIO_TYPES",
  "ALLOWED_IMAGE_TYPES",
  "COOKIE_SECURE",
  "COOKIE_SAME_SITE",
  "EMAIL_DELIVERY_ENABLED",
  "EMAIL_VALIDATE_MX",
  "EXPOSE_OTP_IN_DEVELOPMENT",
  "EXPOSE_RESET_TOKEN_IN_DEVELOPMENT",
];

const BOOLEAN_ENVIRONMENT_VARIABLES = [
  "COOKIE_SECURE",
  "EMAIL_DELIVERY_ENABLED",
  "EMAIL_VALIDATE_MX",
  "EXPOSE_OTP_IN_DEVELOPMENT",
  "EXPOSE_RESET_TOKEN_IN_DEVELOPMENT",
];

function validateUrl(name, allowedProtocols) {
  let value;
  try {
    value = new URL(process.env[name]);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (!allowedProtocols.includes(value.protocol)) {
    throw new Error(`${name} must use ${allowedProtocols.join(" or ")}`);
  }

  return value;
}

function validateOrigin(name, origin) {
  let value;
  try {
    value = new URL(origin);
  } catch {
    throw new Error(`${name} must contain valid HTTP(S) origins`);
  }

  if (
    !["http:", "https:"].includes(value.protocol) ||
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash
  ) {
    throw new Error(`${name} must contain exact HTTP(S) origins without paths`);
  }

  return value;
}

export function validateEnvironment() {
  const missing = REQUIRED_ENVIRONMENT_VARIABLES.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  if (!["development", "test", "production"].includes(process.env.NODE_ENV)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  if (!/^\d+$/.test(process.env.PORT)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  if (!["127.0.0.1", "0.0.0.0", "localhost", "::"].includes(process.env.HOST)) {
    throw new Error("HOST must be 127.0.0.1, 0.0.0.0, localhost, or ::");
  }

  const port = Number.parseInt(process.env.PORT, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  for (const name of BOOLEAN_ENVIRONMENT_VARIABLES) {
    if (!["true", "false"].includes(process.env[name])) {
      throw new Error(`${name} must be true or false`);
    }
  }

  if (!["lax", "strict", "none"].includes(process.env.COOKIE_SAME_SITE.toLowerCase())) {
    throw new Error("COOKIE_SAME_SITE must be lax, strict, or none");
  }

  if (!/^\d+(b|kb|mb|gb)$/i.test(process.env.REQUEST_BODY_LIMIT)) {
    throw new Error("REQUEST_BODY_LIMIT must be a size such as 1mb");
  }

  for (const name of ["AUDIO_MAX_LENGTH", "AUDIO_MAX_FILE_SIZE", "IMAGE_MAX_FILE_SIZE"]) {
    if (!/^\d+$/.test(process.env[name]) || Number(process.env[name]) <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }

  const frontendUrl = validateUrl("FRONTEND_URL", ["http:", "https:"]);
  validateUrl("DATABASE_URL", ["postgres:", "postgresql:"]);
  validateUrl("REDIS_URL", ["redis:", "rediss:"]);

  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS.split(",").map((origin) =>
    validateOrigin("CORS_ALLOWED_ORIGINS", origin.trim()),
  );

  const emailDeliveryEnabled = process.env.EMAIL_DELIVERY_ENABLED === "true";
  if (emailDeliveryEnabled) {
    for (const name of ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_FROM_EMAIL"]) {
      if (!process.env[name]?.trim()) {
        throw new Error(`${name} is required when email delivery is enabled`);
      }
    }
  }

  if (
    process.env.NODE_ENV === "development" &&
    !emailDeliveryEnabled &&
    (process.env.EXPOSE_OTP_IN_DEVELOPMENT !== "true" ||
      process.env.EXPOSE_RESET_TOKEN_IN_DEVELOPMENT !== "true")
  ) {
    throw new Error(
      "Development without email delivery requires both development token exposure flags",
    );
  }

  if (process.env.NODE_ENV === "production") {
    if (process.env.COOKIE_SECURE !== "true") {
      throw new Error("COOKIE_SECURE must be true in production");
    }
    if (frontendUrl.protocol !== "https:") {
      throw new Error("FRONTEND_URL must use https: in production");
    }
    if (corsOrigins.some((origin) => origin.protocol !== "https:")) {
      throw new Error("CORS_ALLOWED_ORIGINS must use https: in production");
    }

    for (const name of ["SESSION_SECRET", "JWT_SECRET", "JWT_SECRET_PASSWORD_RESET"]) {
      if (process.env[name].length < 32) {
        throw new Error(`${name} must be at least 32 characters in production`);
      }
    }

    for (const name of [
      "EXPOSE_OTP_IN_DEVELOPMENT",
      "EXPOSE_RESET_TOKEN_IN_DEVELOPMENT",
    ]) {
      if (process.env[name] === "true") {
        throw new Error(`${name} cannot be true in production`);
      }
    }
  }

  return { port };
}

import crypto from "crypto";

import { withTransaction } from "./dbService.js";
import { isEmailValid, normalizeEmail } from "../utils/emailUtils.js";
import { hashPassword } from "../utils/passwordUtils.js";
import {
  consumeOtpCodeWithQuery,
  generateOtpCode,
} from "../utils/otpUtils.js";

const REGISTRATION_GRANT_EXPIRATION_MINUTES = 15;

function registrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hashRegistrationGrant(grant) {
  return crypto.createHash("sha256").update(grant).digest("hex");
}

async function validateRegistrationEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const validation = await isEmailValid(normalizedEmail);
  if (validation.error) {
    throw registrationError("INVALID_EMAIL", validation.error);
  }
  return normalizedEmail;
}

export async function startRegistration(email) {
  const normalizedEmail = await validateRegistrationEmail(email);

  const accountExists = await withTransaction(async (query) => {
    const result = await query(
      "SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1",
      [normalizedEmail],
    );
    return result.rows.length > 0;
  });

  // Keep this response indistinguishable from a new registration request. The
  // legacy /users/check-email route remains available for the current client.
  if (!accountExists) {
    await generateOtpCode(normalizedEmail, "registration");
  }

  return {
    email: normalizedEmail,
    message: "If registration is available, a verification code has been sent",
  };
}

export async function verifyRegistration(email, otpCode) {
  const normalizedEmail = await validateRegistrationEmail(email);
  const registrationGrant = crypto.randomBytes(32).toString("base64url");
  const grantHash = hashRegistrationGrant(registrationGrant);

  const verification = await withTransaction(async (query) => {
    const otpResult = await consumeOtpCodeWithQuery(
      query,
      normalizedEmail,
      otpCode,
      "registration",
    );
    if (!otpResult.isValid) return otpResult;

    await query(
      `UPDATE registration_grants
          SET used = TRUE
        WHERE email = $1 AND used = FALSE`,
      [normalizedEmail],
    );
    await query(
      `INSERT INTO registration_grants (email, grant_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'))`,
      [normalizedEmail, grantHash, REGISTRATION_GRANT_EXPIRATION_MINUTES],
    );

    return { isValid: true };
  });

  if (!verification.isValid) {
    throw registrationError("INVALID_OTP", verification.reason);
  }

  return { email: normalizedEmail, registrationGrant };
}

export async function completeRegistration({
  email,
  username,
  password,
  registrationGrant,
}) {
  if (!registrationGrant) {
    throw registrationError(
      "INVALID_REGISTRATION_GRANT",
      "Email verification is required",
    );
  }

  const normalizedEmail = await validateRegistrationEmail(email);
  const passwordHash = await hashPassword(password);
  const grantHash = hashRegistrationGrant(registrationGrant);

  return withTransaction(async (query) => {
    const grantResult = await query(
      `SELECT id
         FROM registration_grants
        WHERE grant_hash = $1
          AND email = $2
          AND used = FALSE
          AND expires_at > NOW()
        FOR UPDATE`,
      [grantHash, normalizedEmail],
    );
    if (grantResult.rows.length === 0) {
      throw registrationError(
        "INVALID_REGISTRATION_GRANT",
        "Email verification is invalid or has expired",
      );
    }

    const existingEmail = await query(
      "SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1",
      [normalizedEmail],
    );
    if (existingEmail.rows.length > 0) {
      throw registrationError("REGISTRATION_CONFLICT", "Email is already registered");
    }

    const userResult = await query(
      `INSERT INTO users (
         username, email, password_hash, is_verified, created_at
       )
       VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP)
       RETURNING id, username, email, profile_picture_url, is_verified, created_at, updated_at`,
      [username, normalizedEmail, passwordHash],
    );

    await query(
      "UPDATE registration_grants SET used = TRUE WHERE id = $1",
      [grantResult.rows[0].id],
    );

    return userResult.rows[0];
  });
}

export const registrationInternals = {
  hashRegistrationGrant,
};

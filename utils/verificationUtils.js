// utils/verificationUtils.js
import { queryToDatabase } from "../utils/queryUtils.js";
import moment from 'moment-timezone';

export async function isVerificationCodeValid(email, code) {
  if (!email || !code) {
    throw new Error("Email and code are required");
  }

  const query = `SELECT expires_at FROM verification_codes WHERE email = $1 AND code = $2`;
  const values = [email, code];
  try {
    const result = await queryToDatabase(query, values);

    if (!result || !result.rows || result.rows.length === 0) {
      return { isValid: false, reason: "Verification code not found or invalid" };
    }

    const verification = result.rows[0];
    const { expires_at } = verification;
    if (new Date() > new Date(expires_at)) {
      return { isValid: false, reason: "Code has expired" };
    }

    return { isValid: true };
  } catch (error) {
    console.error("Error verifying code:", error);
    throw new Error("Internal server error");
  }
};

export async function isVerificationCooldownActive(email) {
  const COOLDOWN_PERIOD = 3 * 60 * 1000; // 3 minutes in milliseconds
  const query = `SELECT created_at FROM verification_codes WHERE email = $1`;
  const values = [email];

  try {
    const result = await queryToDatabase(query, values);

    if (!result || !result.rows || result.rows.length === 0) {
      return false; // No previous verification code found, cooldown is not active
    }

    // Parse the created_at time in America/New_York time zone
    const lastCreatedAt = moment.tz(
      result.rows[0].created_at,
      "America/New_York"
    );
    const now = moment.tz("America/New_York"); // Current time in America/New_York time zone

    const timeLeft =
      COOLDOWN_PERIOD - (now.valueOf() - lastCreatedAt.valueOf());
    const minutes = Math.floor(timeLeft / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);

    if (now - lastCreatedAt < COOLDOWN_PERIOD) {
      return true; // Cooldown is active
    }

    return false; // Cooldown is not active
  } catch (error) {
    console.error("Error checking cooldown:", error);
    throw error; // Re-throwing the error after logging it
  }
};

export async function isVerificationCodeExpired(email) {
  const query = `
    SELECT expires_at FROM verification_codes WHERE email = $1
  `;
  const values = [email];
  try {
    const result = await queryToDatabase(query, values);
    if (result.rows.length === 0) {
      return true; // No code found, consider it expired
    }
    const { expires_at } = result.rows[0];
    return new Date() > new Date(expires_at);
  } catch (error) {
    throw error;
  }
};
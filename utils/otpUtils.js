// Backend/utils/otpUtils.js
import crypto from 'crypto';
import { queryToDatabase } from './queryUtils.js';
import { sendOTPCodeToEmail } from './emailUtils.js';
import moment from 'moment-timezone';


export async function generateOtpCode(email, purpose) {
  try {
    await isOtpCooldownActive(email, purpose);
    
    // Generate a new OTP code
    const otpCode = (parseInt(crypto.randomBytes(3).toString('hex'), 16) % 1000000)
      .toString()
      .padStart(6, '0');
      
    await storeOtpCode(email, otpCode, purpose);
    await sendOtpCodeEmail(email, otpCode, purpose);
    
    return otpCode;
  } catch (error) {
    throw error; // This will now include the specific cooldown time
  }
}

export async function storeOtpCode(
  email,
  code,
  purpose,
  expiresAt = new Date(Date.now() + 15 * 60 * 1000) // Set expiration time to 15 minutes from now
) {
  const query = `INSERT INTO otp_codes (email, code, purpose, expires_at) VALUES ($1, $2, $3, $4)`;
  const values = [email, code, purpose, expiresAt];
  try {
    await queryToDatabase(query, values);
  } catch (error) {
    throw error;
  }
}

export async function isOtpCodeValid(email, code, purpose) {
  if (!email || !code || !purpose) {
    throw new Error("Email, code, and purpose are required");
  }

  const query = `SELECT expires_at FROM otp_codes WHERE email = $1 AND code = $2 AND purpose = $3 AND is_valid = TRUE`;
  const values = [email, code, purpose];
  try {
    const result = await queryToDatabase(query, values);

    if (!result || !result.rows || result.rows.length === 0) {
      return { isValid: false, reason: "OTP code not found or invalid" };
    }

    const { expires_at } = result.rows[0];
    if (new Date() > new Date(expires_at)) {
      return { isValid: false, reason: "Code has expired" };
    }

    return { isValid: true };
  } catch (error) {
    console.error("Error verifying code:", error);
    throw new Error("Internal server error");
  }
}

export async function isOtpCooldownActive(email, purpose) {
  const COOLDOWN_PERIOD = 3 * 60 * 1000; // 3 minutes in milliseconds
  const RATE_LIMIT = 5; // Maximum number of OTP requests allowed in the cooldown period (adjust as needed)

  // Step 1: Check how many OTP codes have been requested in the last 5 minutes
  try {
    const result = await queryToDatabase(
      `
      SELECT COUNT(*) FROM otp_codes 
      WHERE email = $1 
      AND purpose = $2 
      AND is_valid = TRUE 
      AND created_at > NOW() - INTERVAL '5 minutes'`,
      [email, purpose]
    );
    const otpRequestCount = parseInt(result.rows[0].count);

    // Check rate limit
    if (otpRequestCount >= RATE_LIMIT) {
      console.warn(
        `Rate limit exceeded: ${otpRequestCount} OTP requests within the last 5 minutes.`
      );
      return true; // Cooldown is active due to rate limiting
    }

    // Check cooldown period
    const lastOtpResult = await queryToDatabase(
      `
      SELECT created_at FROM otp_codes 
      WHERE email = $1 
      AND purpose = $2 
      AND is_valid = TRUE 
      ORDER BY created_at DESC 
      LIMIT 1`,
      [email, purpose]
    );

    if (lastOtpResult.rows.length > 0) {
      const lastCreatedAt = moment.tz(
        lastOtpResult.rows[0].created_at,
        "America/New_York"
      );
      const now = moment.tz("America/New_York");
      const timeLeft =
        COOLDOWN_PERIOD - (now.valueOf() - lastCreatedAt.valueOf());

      if (timeLeft > 0) {
        const minutes = Math.floor(timeLeft / 60000);
        const seconds = Math.floor((timeLeft % 60000) / 1000);
        throw new Error(
          `Please wait ${minutes}:${
            seconds < 10 ? "0" : ""
          }${seconds} minutes before requesting a new code.`
        );
      }
    }

    return false; // Cooldown is not active
  } catch (error) {
    // Re-throw the specific error messages we created
    if (
      error.message.includes("Please wait") ||
      error.message.includes("Too many attempts")
    ) {
      throw error;
    }
    // For unexpected errors, throw a generic error
    console.error("Error checking cooldown:", error);
    throw new Error("An error occurred while checking cooldown status");
  }
}
  
export async function isOptExpired(email, code, purpose) {
    const query = `SELECT expires_at FROM otp_codes WHERE email = $1 AND code = $2 AND purpose = $3`;
    const values = [email, code, purpose];
    try {
        const result = await queryToDatabase(query, values);
    
        if (!result || !result.rows || result.rows.length === 0) {
        return true; // OTP code not found or invalid
        }
    
        const { expires_at } = result.rows[0];
        return new Date() > new Date(expires_at);
    } catch (error) {
        console.error("Error checking OTP expiration:", error);
        throw error;
    }
};

export async function useOtpCode(email, code, purpose) {
    // Check if the OTP code is valid before invalidating it
    const { isValid, reason } = await isOtpCodeValid(email, code, purpose);
    if (!isValid) {
        throw new Error(`Cannot use OTP code: ${reason}`);
    }

    // Invalidate all previous OTP codes for the same email and purpose
    const invalidatePreviousOtpsQuery = `UPDATE otp_codes SET is_valid = FALSE WHERE email = $1 AND purpose = $2`;
    const invalidatePreviousOtpsValues = [email, purpose];
    try {
        await queryToDatabase(invalidatePreviousOtpsQuery, invalidatePreviousOtpsValues);
    } catch (error) {
        console.error("Error invalidating previous OTP codes:", error);
        throw error;
    }

    // Mark the current OTP code as used
    const useOtpQuery = `UPDATE otp_codes SET used = TRUE WHERE email = $1 AND code = $2 AND purpose = $3`;
    const useOtpValues = [email, code, purpose];
    try {
        await queryToDatabase(useOtpQuery, useOtpValues);
    } catch (error) {
        console.error("Error using OTP code:", error);
        throw error;
    }
}

export async function sendOtpCodeEmail(email, code, purpose) {
    sendOTPCodeToEmail(email, code, purpose);
  }
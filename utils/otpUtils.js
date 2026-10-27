import crypto from "crypto";
import { queryToDatabase, withTransaction } from "../services/dbService.js";
import { sendVerificationEmail } from "../services/emailService.js";
import { normalizeEmail } from "./emailUtils.js";

const OTP_EXPIRATION_MINUTES = 10;
const OTP_REQUEST_LIMIT_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;

function hashOtp(email, code, purpose) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(`${purpose}\0${normalizeEmail(email)}\0${code}`)
    .digest("hex");
}

function hashesMatch(expectedHash, actualHash) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function acquireOtpLock(query, email, purpose) {
  await query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [`otp:${purpose}:${normalizeEmail(email)}`],
  );
}

async function getOtpLimitStatus(query, email, purpose) {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (
         WHERE created_at > NOW() - INTERVAL '1 hour'
       )::integer AS request_count,
       COALESCE(
         MAX(created_at) > NOW() - INTERVAL '60 seconds',
         FALSE
       ) AS cooldown_active
     FROM otp_codes
     WHERE email = $1 AND purpose = $2`,
    [normalizeEmail(email), purpose],
  );
  const { request_count: requestCount, cooldown_active: cooldownActive } = result.rows[0];

  return {
    limited: cooldownActive || requestCount >= OTP_REQUEST_LIMIT_PER_HOUR,
  };
}

async function validateOtpWithQuery(query, email, code, purpose, consume) {
  const normalizedEmail = normalizeEmail(email);
  await acquireOtpLock(query, normalizedEmail, purpose);

  const result = await query(
    `SELECT id, code_hash, attempts, expires_at
       FROM otp_codes
      WHERE email = $1 AND purpose = $2 AND is_valid = TRUE AND used = FALSE
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [normalizedEmail, purpose],
  );

  if (result.rows.length === 0) {
    return { isValid: false, reason: "OTP code not found or invalid" };
  }

  const otp = result.rows[0];
  if (new Date(otp.expires_at).getTime() <= Date.now()) {
    await query("UPDATE otp_codes SET is_valid = FALSE WHERE id = $1", [otp.id]);
    return { isValid: false, reason: "Code has expired" };
  }

  const submittedHash = hashOtp(normalizedEmail, code, purpose);
  if (!hashesMatch(otp.code_hash, submittedHash)) {
    await query(
      `UPDATE otp_codes
          SET attempts = attempts + 1,
              is_valid = CASE WHEN attempts + 1 >= $2 THEN FALSE ELSE is_valid END
        WHERE id = $1`,
      [otp.id, OTP_MAX_ATTEMPTS],
    );
    return { isValid: false, reason: "OTP code not found or invalid" };
  }

  if (consume) {
    await query(
      `UPDATE otp_codes
          SET is_valid = FALSE,
              used = CASE WHEN id = $3 THEN TRUE ELSE used END
        WHERE email = $1 AND purpose = $2 AND is_valid = TRUE`,
      [normalizedEmail, purpose, otp.id],
    );
  }

  return { isValid: true };
}

export async function generateOtpCode(email, purpose) {
  const normalizedEmail = normalizeEmail(email);
  const otpCode = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = hashOtp(normalizedEmail, otpCode, purpose);

  const otpId = await withTransaction(async (query) => {
    await acquireOtpLock(query, normalizedEmail, purpose);
    const { limited } = await getOtpLimitStatus(query, normalizedEmail, purpose);
    if (limited) {
      const error = new Error(
        "Too many verification-code requests. Please try again later.",
      );
      error.code = "OTP_RATE_LIMITED";
      throw error;
    }

    await query(
      `UPDATE otp_codes
          SET is_valid = FALSE
        WHERE email = $1 AND purpose = $2 AND is_valid = TRUE`,
      [normalizedEmail, purpose],
    );
    const result = await query(
      `INSERT INTO otp_codes (email, code_hash, purpose, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'))
       RETURNING id`,
      [normalizedEmail, codeHash, purpose, OTP_EXPIRATION_MINUTES],
    );

    return result.rows[0].id;
  });

  try {
    await sendVerificationEmail(normalizedEmail, otpCode);
  } catch (error) {
    await queryToDatabase(
      "UPDATE otp_codes SET is_valid = FALSE WHERE id = $1",
      [otpId],
    );
    throw error;
  }

  return otpCode;
}

export function isOtpCodeValid(email, code, purpose) {
  if (!email || !code || !purpose) {
    throw new Error("Email, code, and purpose are required");
  }

  return withTransaction((query) =>
    validateOtpWithQuery(query, email, code, purpose, false),
  );
}

export function consumeOtpCodeWithQuery(query, email, code, purpose) {
  if (!email || !code || !purpose) {
    throw new Error("Email, code, and purpose are required");
  }

  return validateOtpWithQuery(query, email, code, purpose, true);
}

export async function isOtpCooldownActive(email, purpose) {
  const { limited } = await getOtpLimitStatus(
    queryToDatabase,
    normalizeEmail(email),
    purpose,
  );
  return limited;
}

// controllers/otpController.js
import {
  isOtpCooldownActive,
} from "../utils/otpUtils.js";
import {
  startRegistration,
  verifyRegistration,
} from "../services/registrationService.js";
import Joi from "joi";

const otpIdentitySchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  purpose: Joi.string().valid("registration").required(),
});

const otpVerificationSchema = otpIdentitySchema.keys({
  otp_code: Joi.string().pattern(/^\d{6}$/).required(),
});

export async function generateOtp(req, res) {
  const { error, value } = otpIdentitySchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.EMAIL_DELIVERY_ENABLED !== "true"
  ) {
    return res.status(503).json({
      error: "Email verification is temporarily unavailable",
    });
  }

  try {
    const { email } = value;
    const registration = await startRegistration(email);
    res.status(200).json({ message: registration.message });
  } catch (error) {
    console.error("Unable to generate verification code", {
      code: error.code || "OTP_GENERATION_FAILED",
    });
    if (error.code === "OTP_RATE_LIMITED") {
      return res.status(429).json({ error: error.message });
    }
    if (error.code === "EMAIL_DELIVERY_FAILED") {
      return res.status(503).json({
        error: "Email verification is temporarily unavailable",
      });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function verifyOtp(req, res) {
  const { error, value } = otpVerificationSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const { email, otp_code } = value;
    const verification = await verifyRegistration(email, otp_code);
    req.session.registration = verification;
    res.status(200).json({
      message: "Email verified",
      registrationGrant: verification.registrationGrant,
    });
  } catch (error) {
    console.error("Unable to verify code", {
      code: error.code || "OTP_VERIFICATION_FAILED",
    });
    if (error.code === "INVALID_OTP") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function checkOtpCooldown(req, res) {
  const { error, value } = otpIdentitySchema.validate(req.query);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const { email, purpose } = value;
    const cooldownActive = await isOtpCooldownActive(email, purpose);
    res.status(200).json({ cooldownActive });
  } catch (error) {
    console.error("Unable to check verification-code cooldown", {
      code: error.code || "OTP_COOLDOWN_CHECK_FAILED",
    });
    res.status(500).json({ error: "Internal server error" });
  }
}

// controllers/otpController.js
import {
  generateOtpCode,
  isOtpCodeValid,
  isOtpCooldownActive,
} from "../utils/otpUtils.js";
import Joi from "joi";

const otpIdentitySchema = Joi.object({
  email: Joi.string().email().required(),
  purpose: Joi.string()
    .valid("registration", "reset_password", "verification")
    .required(),
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
    const { email, purpose } = value;
    const otpCode = await generateOtpCode(email, purpose);
    const response = { message: "Verification code generated" };

    if (
      process.env.NODE_ENV === "development" &&
      process.env.EXPOSE_OTP_IN_DEVELOPMENT === "true"
    ) {
      response.otpCode = otpCode;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Error generating OTP code:", error);
    const status = error.code === "OTP_RATE_LIMITED" ? 429 : 500;
    res.status(status).json({ error: error.message || "Internal server error" });
  }
}

export async function verifyOtp(req, res) {
  const { error, value } = otpVerificationSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const { email, otp_code, purpose } = value;
    const { isValid, reason } = await isOtpCodeValid(email, otp_code, purpose);
    if (!isValid) {
      return res.status(400).json({ error: `${reason}` });
    }
    res.status(200).json({ message: "OTP code is valid" });
  } catch (error) {
    console.error("Error verifying OTP code:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
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
    console.error("Error checking OTP cooldown:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}

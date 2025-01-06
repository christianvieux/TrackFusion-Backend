// Backend/controllers/otpController.js
import {
  generateOtpCode,
  isOtpCodeValid,
  isOtpCooldownActive,
} from "../utils/otpUtils.js";

export async function generateOtp(req, res) {
  const { email, purpose } = req.body;

  if (!email || !purpose) {
    return res.status(400).json({ error: "Email and purpose are required" });
  }

  try {
    const otpCode = await generateOtpCode(email, purpose);
    res.status(200).json({ otpCode });
  } catch (error) {
    console.error("Error generating OTP code:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}

export async function verifyOtp(req, res) {
  const { email, otp_code, purpose } = req.body;

  if (!email || !otp_code || !purpose) {
    return res
      .status(400)
      .json({ error: "Email, otp_code, and purpose are required" });
  }

  try {
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
  const { email, purpose } = req.query;

  if (!email || !purpose) {
    return res.status(400).json({ error: "Email and purpose are required" });
  }

  try {
    const cooldownActive = await isOtpCooldownActive(email, purpose);
    res.status(200).json({ cooldownActive });
  } catch (error) {
    console.error("Error checking OTP cooldown:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
}
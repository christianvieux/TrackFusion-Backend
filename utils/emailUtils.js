// utils/emailUtils.js

// env variables
import dotenv from 'dotenv'; dotenv.config();

// 
import { promises as dns } from 'dns';
import validator from 'validator';
import disposableEmailDomains from 'disposable-email-domains/index.js';
import { mailgunService } from "../services/mailgunService.js";

function isEnabled(name) {
  return process.env[name] === "true";
}

const getEmailMessage = (email, code, purpose) => {
  const subject = purpose === "registration"
    ? "Verify your TrackFusion email"
    : "Reset your TrackFusion password";

  const baseMessage = {
    to: email,
    from: process.env.MAILGUN_FROM_EMAIL,
    subject,
    template: {
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <header style="margin-bottom: 20px;">
              <h2 style="color: #333;">TrackFusion</h2>
            </header>
            ${purpose === "registration" ? 
              `<h3>Verify Your Email Address</h3>
               <p>Thank you for creating a TrackFusion account. Please enter this verification code to complete your registration:</p>`
              : 
              `<h3>Reset Your Password</h3>
               <p>We received a request to reset your password. Please enter this security code to continue:</p>`
            }
            <div style="background: #f5f5f5; padding: 15px; margin: 20px 0; text-align: center;">
              <span style="font-size: 24px; font-weight: bold; color: #4A90E2;">${code}</span>
            </div>
            <p>This code will expire in 10 minutes.</p>
            <p>If you didn't request this, please ignore this email or contact support if you have concerns.</p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <footer style="color: #666; font-size: 12px;">
              <p>This is an automated message from TrackFusion. Please do not reply to this email.</p>
              <p>TrackFusion, [Your Business Address]</p>
            </footer>
          </div>
        </body>
        </html>
      `,
      text: `
        TrackFusion
        
        ${purpose === "registration" ? "Verify Your Email Address" : "Reset Your Password"}
        
        Your verification code is: ${code}
        
        This code will expire in 10 minutes.
        
        If you didn't request this, please ignore this email or contact support if you have concerns.
        
        This is an automated message from TrackFusion. Please do not reply to this email.
      `
    }
  };

  return baseMessage;
};

export async function sendOTPCodeToEmail(email, code, purpose) {
  if (!isEnabled("EMAIL_DELIVERY_ENABLED")) return;

  const msg = getEmailMessage(email, code, purpose);
  await mailgunService.sendEmail(
    msg.to,
    msg.subject,
    msg.template.text,
    msg.template.html,
  );
}

export async function sendPasswordResetCodeEmail(email, resetLink) {
  if (!isEnabled("EMAIL_DELIVERY_ENABLED")) return;

  await mailgunService.sendEmail(
    email,
    "Password Reset",
    `You can reset your password by clicking on the following link: ${resetLink}`,
    `
        <h2>Password Reset</h2>
        <p>You can reset your password by clicking on the following link:</p>
        <a href="${resetLink}" style="color: #4A90E2;">${resetLink}</a>
      `
  );
}

export async function sendTestEmail(email) {
  return mailgunService.sendTestEmail(email);
}

export async function isEmailValid(email) {
  if (!validator.isEmail(email)) {
    return { error: "Invalid email format" };
  }

  const domain = email.split("@")[1];

  const allowedDomains = (process.env.EMAIL_ALLOWED_DOMAINS || "")
    .split(",")
    .map((allowedDomain) => allowedDomain.trim().toLowerCase())
    .filter(Boolean);

  if (allowedDomains.length > 0 && !allowedDomains.includes(domain.toLowerCase())) {
    return { error: "Email domain not allowed" };
  }

  if (disposableEmailDomains.includes(domain.toLowerCase())) {
    return { error: "Disposable email addresses are not allowed" };
  }

  if (!isEnabled("EMAIL_VALIDATE_MX")) {
    return { error: null };
  }

  try {
    const addresses = await dns.resolveMx(domain);
    if (addresses.length === 0) {
      return { error: "Invalid email domain" };
    }
  } catch (error) {
    console.error("Error validating email domain:", error);
    return { error: "Error validating email domain" };
  }

  return { error: null };
}

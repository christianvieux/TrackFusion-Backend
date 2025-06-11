// utils/emailUtils.js

// env variables
import dotenv from 'dotenv'; dotenv.config();

// 
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import validator from 'validator';
import { mailgunService } from "../services/mailgunService.js";



const disposableEmailDomains = JSON.parse(
  fs.readFileSync(
    path.resolve("node_modules/disposable-email-domains/index.json"),
    "utf8"
  )
);

const ALLOWED_DOMAINS = [
  // 'example.com'
]; // Allowed email domains for production
const DEVELOPMENT_MODE = process.env.NODE_ENV === 'development'; // Set your environment variable accordingly








const getEmailMessage = (email, code, purpose) => {
  const baseMessage = {
    to: email,
    from: process.env.MAILGUN_FROM_EMAIL,
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
  const msg = getEmailMessage(email, code, purpose);
  await mailgunService.sendEmail(msg.to, msg.subject, msg.text, msg.html);
}

export async function sendPasswordResetCodeEmail(email, resetLink) {
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

  if (!DEVELOPMENT_MODE && !ALLOWED_DOMAINS.includes(domain)) {
    return { error: "Email domain not allowed" };
  }

  if (disposableEmailDomains.includes(domain)) {
    return { error: "Disposable email addresses are not allowed" };
  }

  try {
    const isValidDomain = await new Promise((resolve) => {
      dns.resolveMx(domain, (err, addresses) => {
        resolve(!err && addresses && addresses.length > 0);
      });
    });

    if (!isValidDomain) {
      return { error: "Invalid email domain" };
    }
  } catch (error) {
    console.error("Error validating email domain:", error);
    return { error: "Error validating email domain" };
  }

  return { error: null };
}
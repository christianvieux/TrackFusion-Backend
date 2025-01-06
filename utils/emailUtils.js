// utils/emailUtils.js
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import validator from 'validator';
import sgMail from '@sendgrid/mail';
// env variables
import dotenv from 'dotenv'; dotenv.config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const disposableEmailDomains = JSON.parse(
  fs.readFileSync(path.resolve('node_modules/disposable-email-domains/index.json'), 'utf8')
);

const ALLOWED_DOMAINS = [
  // 'example.com'
]; // Allowed email domains for production
const DEVELOPMENT_MODE = true //process.env.NODE_ENV === 'development'; // Set your environment variable accordingly


export async function sendOTPCodeToEmail(email, code, purpose) {
  // const verificationLink = `http://yourdomain.com/verify-email?code=${code}`;
  const msg = getEmailMessage(email, code, purpose);
  await sgMail.send(msg);

  console.log("Email sent to:", email, code);
}

const getEmailMessage = (email, code, purpose) => {
  switch (purpose) {
    case 'registration':
      return {
        to: email,
        from: process.env.AUTH_EMAIL_USER,
        subject: 'Email Verification',
        text: `Please verify your email by entering the following code: ${code}`,
      };
    case 'password_reset':
      return {
        to: email,
        from: process.env.AUTH_EMAIL_USER,
        subject: 'Password Reset',
        text: `You can reset your password by entering the following code: ${code}`,
      };
    default:
      throw new Error('Invalid purpose');
  }
};

export async function sendPasswordResetCodeEmail(email, resetLink) {
    const msg = {
      to: email,
      from: process.env.AUTH_EMAIL_USER,
      subject: 'Password Reset',
      text: `You can reset your password by clicking on the following link: ${resetLink}`,
    };
    console.log("Sending password reset email to:", email, resetLink);
  
    await sgMail.send(msg);
  }

export async function sendTestEmail(email) {
  const msg = {
    to: email,
    from: process.env.AUTH_EMAIL_USER,
    subject: 'Test Email',
    text: 'This is a test email to verify that the email sending functionality works.',
  };

  try {
    const response = await sgMail.send(msg);
    console.log("Test email sent", response);
  } catch (error) {
    console.error("Error sending test email:", error);
  }
}

export async function isEmailValid(email) {
  if (!validator.isEmail(email)) {
    return { error: "Invalid email format" };
  }

  const domain = email.split('@')[1];

  if (!DEVELOPMENT_MODE) {
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return { error: "Email domain not allowed" };
    }
  }

  if (disposableEmailDomains.includes(domain)) {
    return { error: "Disposable email addresses are not allowed" };
  }

  try {
    const isValidDomain = await new Promise((resolve) => {
      dns.resolveMx(domain, (err, addresses) => {
        if (err || addresses.length === 0) {
          return resolve(false);
        }
        resolve(true);
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
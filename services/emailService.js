import { Resend } from "resend";
import nodemailer from "nodemailer";

const FROM_ADDRESS = "TrackFusionWeb <verify@mail.trackfusionweb.com>";
const DELIVERY_TIMEOUT_MS = 10_000;

let resendClient;
let smtpClient;

function getResendClient() {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  return resendClient;
}

function getSmtpClient() {
  if (!smtpClient) {
    smtpClient = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number.parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === "true",
      connectionTimeout: DELIVERY_TIMEOUT_MS,
      greetingTimeout: DELIVERY_TIMEOUT_MS,
      socketTimeout: DELIVERY_TIMEOUT_MS,
      ...(process.env.SMTP_USERNAME
        ? {
            auth: {
              user: process.env.SMTP_USERNAME,
              pass: process.env.SMTP_PASSWORD,
            },
          }
        : {}),
    });
  }

  return smtpClient;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendEmail({ to, subject, text, html }) {
  if (process.env.EMAIL_DELIVERY_ENABLED !== "true") {
    return;
  }

  let error;
  try {
    const message = { from: FROM_ADDRESS, to, subject, text, html };
    if (process.env.EMAIL_PROVIDER === "smtp") {
      await getSmtpClient().sendMail(message);
    } else {
      ({ error } = await getResendClient().emails.send(
        message,
        { signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS) },
      ));
    }
  } catch (providerError) {
    error = providerError;
  }

  if (error) {
    const deliveryError = new Error("Transactional email delivery failed");
    deliveryError.code = "EMAIL_DELIVERY_FAILED";
    deliveryError.statusCode = error.statusCode;
    throw deliveryError;
  }
}

export function sendVerificationEmail(email, code) {
  const safeCode = escapeHtml(code);

  return sendEmail({
    to: email,
    subject: "Verify your TrackFusionWeb email",
    text: [
      "Verify your TrackFusionWeb email",
      "",
      `Your verification code is: ${code}`,
      "",
      "This code expires in 10 minutes. If you did not request it, you can ignore this email.",
    ].join("\n"),
    html: `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#222;">
          <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
            <div style="background:#fff;border-radius:12px;padding:32px;">
              <h1 style="font-size:24px;margin:0 0 20px;">Verify your email</h1>
              <p>Enter this code to finish creating your TrackFusionWeb account:</p>
              <p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;margin:28px 0;">${safeCode}</p>
              <p>This code expires in 10 minutes.</p>
              <p style="color:#666;font-size:14px;">If you did not request this code, you can ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
}

export function sendPasswordResetEmail(email, resetLink) {
  const safeResetLink = escapeHtml(resetLink);

  return sendEmail({
    to: email,
    subject: "Reset your TrackFusionWeb password",
    text: [
      "Reset your TrackFusionWeb password",
      "",
      `Open this link to choose a new password: ${resetLink}`,
      "",
      "This link expires in 15 minutes. If you did not request it, you can ignore this email.",
    ].join("\n"),
    html: `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#222;">
          <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
            <div style="background:#fff;border-radius:12px;padding:32px;">
              <h1 style="font-size:24px;margin:0 0 20px;">Reset your password</h1>
              <p>Use the button below to choose a new TrackFusionWeb password.</p>
              <p style="margin:28px 0;">
                <a href="${safeResetLink}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;border-radius:8px;padding:12px 20px;">Reset password</a>
              </p>
              <p>This link expires in 15 minutes.</p>
              <p style="color:#666;font-size:14px;">If you did not request this reset, you can ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
}

export function sendPasswordChangedEmail(email) {
  return sendEmail({
    to: email,
    subject: "Your TrackFusionWeb password was changed",
    text: "Your TrackFusionWeb password was changed. If you did not make this change, contact support immediately.",
    html: `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#222;">
          <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
            <div style="background:#fff;border-radius:12px;padding:32px;">
              <h1 style="font-size:24px;margin:0 0 20px;">Password changed</h1>
              <p>Your TrackFusionWeb password was changed successfully.</p>
              <p style="color:#666;font-size:14px;">If you did not make this change, contact support immediately.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  });
}

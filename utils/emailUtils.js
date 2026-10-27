import { promises as dns } from 'dns';
import validator from 'validator';
import disposableEmailDomains from 'disposable-email-domains/index.js';

function isEnabled(name) {
  return process.env[name] === "true";
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export async function isEmailValid(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!validator.isEmail(normalizedEmail)) {
    return { error: "Invalid email format" };
  }

  const domain = normalizedEmail.split("@")[1];

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

import dotenv from "dotenv";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

function envBoolean(name, fallback) {
  const value = process.env[name];

  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function normalizeSameSite(value) {
  const sameSite = value?.toLowerCase();

  if (["lax", "strict", "none"].includes(sameSite)) {
    return sameSite;
  }

  return isProduction ? "none" : "lax";
}

const sameSite = normalizeSameSite(process.env.COOKIE_SAME_SITE);
const requestedSecureCookie = envBoolean("COOKIE_SECURE", isProduction);
const secureCookie = sameSite === "none" ? true : requestedSecureCookie;
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

export const baseCookieOptions = {
  httpOnly: true,
  secure: secureCookie,
  sameSite,
  path: "/",
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export const sessionCookieOptions = {
  ...baseCookieOptions,
  maxAge: 60 * 60000,
};

export const tokenCookieOptions = {
  ...baseCookieOptions,
  maxAge: 60 * 60000,
};

export const clearCookieOptions = {
  ...baseCookieOptions,
};

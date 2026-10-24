import { rateLimit } from "express-rate-limit";

function createLimiter({ limit, message, windowMs = 15 * 60 * 1000 }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message },
  });
}

export const apiLimiter = createLimiter({
  limit: 300,
  message: "Too many requests. Please try again later.",
});

export const authLimiter = createLimiter({
  limit: 20,
  message: "Too many authentication attempts. Please try again later.",
});

export const otpLimiter = createLimiter({
  limit: 10,
  message: "Too many verification-code requests. Please try again later.",
});

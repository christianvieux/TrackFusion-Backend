import crypto from "crypto";

const mockQueryToDatabase = jest.fn();
const mockWithTransaction = jest.fn();
const mockSendVerificationEmail = jest.fn();

jest.mock("../services/dbService.js", () => ({
  queryToDatabase: (...args) => mockQueryToDatabase(...args),
  withTransaction: (...args) => mockWithTransaction(...args),
}));
jest.mock("../services/emailService.js", () => ({
  sendVerificationEmail: (...args) => mockSendVerificationEmail(...args),
}));

import {
  consumeOtpCodeWithQuery,
  generateOtpCode,
  isOtpCodeValid,
  isOtpCooldownActive,
} from "./otpUtils.js";

const originalEnvironment = { ...process.env };

function otpHash(email, code) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(`registration\0${email}\0${code}`)
    .digest("hex");
}

function createOtpQuery({ code = "123456", expiresAt } = {}) {
  const state = {
    active: true,
    attempts: 0,
    used: false,
    expiresAt: expiresAt || new Date(Date.now() + 60_000),
  };
  const query = jest.fn(async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("SELECT id, code_hash")) {
      return {
        rows: state.active
          ? [{
              id: 9,
              code_hash: otpHash("listener@example.com", code),
              attempts: state.attempts,
              expires_at: state.expiresAt,
            }]
          : [],
      };
    }
    if (sql.includes("attempts = attempts + 1")) {
      state.attempts += 1;
      if (state.attempts >= 5) state.active = false;
      return { rows: [] };
    }
    if (sql.includes("SET is_valid = FALSE") && sql.includes("WHERE id = $1")) {
      state.active = false;
      return { rows: [] };
    }
    if (sql.includes("used = CASE")) {
      state.active = false;
      state.used = true;
      return { rows: [] };
    }
    throw new Error(`Unexpected test query: ${sql}`);
  });
  return { query, state };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = "otp-test-secret";
});

afterAll(() => {
  process.env = originalEnvironment;
});

test("expires an OTP and refuses it", async () => {
  const { query, state } = createOtpQuery({
    expiresAt: new Date(Date.now() - 1_000),
  });
  mockWithTransaction.mockImplementation((callback) => callback(query));

  await expect(
    isOtpCodeValid("listener@example.com", "123456", "registration"),
  ).resolves.toEqual({ isValid: false, reason: "Code has expired" });
  expect(state.active).toBe(false);
});

test("invalidates an OTP after five failed attempts", async () => {
  const { query, state } = createOtpQuery();
  mockWithTransaction.mockImplementation((callback) => callback(query));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(
      isOtpCodeValid("listener@example.com", "000000", "registration"),
    ).resolves.toMatchObject({ isValid: false });
  }
  await expect(
    isOtpCodeValid("listener@example.com", "123456", "registration"),
  ).resolves.toMatchObject({ isValid: false });
  expect(state.attempts).toBe(5);
  expect(state.active).toBe(false);
});

test("consumes an OTP once and prevents replay", async () => {
  const { query, state } = createOtpQuery();

  await expect(
    consumeOtpCodeWithQuery(
      query,
      "listener@example.com",
      "123456",
      "registration",
    ),
  ).resolves.toEqual({ isValid: true });
  await expect(
    consumeOtpCodeWithQuery(
      query,
      "listener@example.com",
      "123456",
      "registration",
    ),
  ).resolves.toMatchObject({ isValid: false });
  expect(state.used).toBe(true);
});

test("reports the persisted resend cooldown", async () => {
  mockQueryToDatabase.mockResolvedValue({
    rows: [{ request_count: 1, cooldown_active: true }],
  });

  await expect(
    isOtpCooldownActive("listener@example.com", "registration"),
  ).resolves.toBe(true);
});

test("rejects OTP generation during cooldown without sending email", async () => {
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{ request_count: 1, cooldown_active: true }],
    });
  mockWithTransaction.mockImplementation((callback) => callback(query));

  await expect(
    generateOtpCode("listener@example.com", "registration"),
  ).rejects.toMatchObject({ code: "OTP_RATE_LIMITED" });
  expect(mockSendVerificationEmail).not.toHaveBeenCalled();
});

test("invalidates a newly stored OTP when email delivery fails", async () => {
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [{ request_count: 0, cooldown_active: false }],
    })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 27 }] });
  mockWithTransaction.mockImplementation((callback) => callback(query));
  mockSendVerificationEmail.mockRejectedValue(
    Object.assign(new Error("SMTP unavailable"), { code: "EMAIL_DELIVERY_FAILED" }),
  );
  mockQueryToDatabase.mockResolvedValue({ rows: [] });

  await expect(
    generateOtpCode("listener@example.com", "registration"),
  ).rejects.toMatchObject({ code: "EMAIL_DELIVERY_FAILED" });
  expect(mockQueryToDatabase).toHaveBeenCalledWith(
    "UPDATE otp_codes SET is_valid = FALSE WHERE id = $1",
    [27],
  );
});

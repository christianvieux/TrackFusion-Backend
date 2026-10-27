const mockWithTransaction = jest.fn();
const mockGenerateOtpCode = jest.fn();
const mockConsumeOtpCodeWithQuery = jest.fn();
const mockHashPassword = jest.fn();
const mockIsEmailValid = jest.fn();

jest.mock("./dbService.js", () => ({
  withTransaction: (...args) => mockWithTransaction(...args),
}));
jest.mock("../utils/otpUtils.js", () => ({
  generateOtpCode: (...args) => mockGenerateOtpCode(...args),
  consumeOtpCodeWithQuery: (...args) => mockConsumeOtpCodeWithQuery(...args),
}));
jest.mock("../utils/passwordUtils.js", () => ({
  hashPassword: (...args) => mockHashPassword(...args),
}));
jest.mock("../utils/emailUtils.js", () => ({
  normalizeEmail: (email) => email.trim().toLowerCase(),
  isEmailValid: (...args) => mockIsEmailValid(...args),
}));

import {
  completeRegistration,
  startRegistration,
  verifyRegistration,
} from "./registrationService.js";

beforeEach(() => {
  jest.clearAllMocks();
  mockIsEmailValid.mockResolvedValue({ error: null });
  mockHashPassword.mockResolvedValue("password-hash");
});

test("starts registration for a normalized, unregistered email", async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  mockWithTransaction.mockImplementation((callback) => callback(query));
  mockGenerateOtpCode.mockResolvedValue("123456");

  const result = await startRegistration("  Listener@Example.COM ");

  expect(mockGenerateOtpCode).toHaveBeenCalledWith(
    "listener@example.com",
    "registration",
  );
  expect(result.message).toMatch(/verification code/i);
  expect(result).not.toHaveProperty("otpCode");
});

test("returns the same start response for an existing email without sending", async () => {
  const query = jest.fn().mockResolvedValue({ rows: [{ exists: true }] });
  mockWithTransaction.mockImplementation((callback) => callback(query));

  const result = await startRegistration("listener@example.com");

  expect(mockGenerateOtpCode).not.toHaveBeenCalled();
  expect(result.message).toMatch(/verification code/i);
});

test("rejects invalid email before creating a registration challenge", async () => {
  mockIsEmailValid.mockResolvedValue({ error: "Invalid email format" });

  await expect(startRegistration("invalid")).rejects.toMatchObject({
    code: "INVALID_EMAIL",
    message: "Invalid email format",
  });
  expect(mockWithTransaction).not.toHaveBeenCalled();
});

test("does not leave a usable registration flow when email delivery fails", async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  mockWithTransaction.mockImplementation((callback) => callback(query));
  mockGenerateOtpCode.mockRejectedValue(
    Object.assign(new Error("delivery failed"), { code: "EMAIL_DELIVERY_FAILED" }),
  );

  await expect(startRegistration("listener@example.com")).rejects.toMatchObject({
    code: "EMAIL_DELIVERY_FAILED",
  });
});

test("consumes an OTP and returns an opaque registration grant", async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  mockWithTransaction.mockImplementation((callback) => callback(query));
  mockConsumeOtpCodeWithQuery.mockResolvedValue({ isValid: true });

  const result = await verifyRegistration("listener@example.com", "123456");

  expect(mockConsumeOtpCodeWithQuery).toHaveBeenCalledWith(
    query,
    "listener@example.com",
    "123456",
    "registration",
  );
  expect(result.registrationGrant).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO registration_grants"),
    expect.arrayContaining(["listener@example.com"]),
  );
});

test.each([
  "OTP code not found or invalid",
  "Code has expired",
])("does not create a grant for rejected OTPs: %s", async (reason) => {
  const query = jest.fn();
  mockWithTransaction.mockImplementation((callback) => callback(query));
  mockConsumeOtpCodeWithQuery.mockResolvedValue({ isValid: false, reason });

  await expect(
    verifyRegistration("listener@example.com", "000000"),
  ).rejects.toMatchObject({ code: "INVALID_OTP", message: reason });
  expect(query).not.toHaveBeenCalled();
});

test("creates a verified user and consumes the grant in one transaction", async () => {
  const user = {
    id: 7,
    username: "listener",
    email: "listener@example.com",
    is_verified: true,
  };
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: 11 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [user] })
    .mockResolvedValueOnce({ rows: [] });
  mockWithTransaction.mockImplementation((callback) => callback(query));

  await expect(
    completeRegistration({
      email: "Listener@Example.com",
      username: "listener",
      password: "correct horse battery staple",
      registrationGrant: "opaque-registration-grant",
    }),
  ).resolves.toEqual(user);

  expect(mockHashPassword).toHaveBeenCalledWith("correct horse battery staple");
  expect(query.mock.calls[2][0]).toContain("INSERT INTO users");
  expect(query.mock.calls[3]).toEqual([
    "UPDATE registration_grants SET used = TRUE WHERE id = $1",
    [11],
  ]);
});

test("rejects an expired or reused registration grant", async () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  mockWithTransaction.mockImplementation((callback) => callback(query));

  await expect(
    completeRegistration({
      email: "listener@example.com",
      username: "listener",
      password: "password123",
      registrationGrant: "expired-or-reused-grant",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REGISTRATION_GRANT" });
  expect(query).toHaveBeenCalledTimes(1);
});

test("reports duplicate email before attempting the insert", async () => {
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: 11 }] })
    .mockResolvedValueOnce({ rows: [{ exists: true }] });
  mockWithTransaction.mockImplementation((callback) => callback(query));

  await expect(
    completeRegistration({
      email: "listener@example.com",
      username: "new-name",
      password: "password123",
      registrationGrant: "valid-registration-grant",
    }),
  ).rejects.toMatchObject({ code: "REGISTRATION_CONFLICT" });
  expect(query).toHaveBeenCalledTimes(2);
});

test("propagates an insert failure so the database transaction can roll back", async () => {
  const databaseError = Object.assign(new Error("database unavailable"), {
    code: "08006",
  });
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: 11 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(databaseError);
  mockWithTransaction.mockImplementation((callback) => callback(query));

  await expect(
    completeRegistration({
      email: "listener@example.com",
      username: "listener",
      password: "password123",
      registrationGrant: "valid-registration-grant",
    }),
  ).rejects.toBe(databaseError);
  expect(query).toHaveBeenCalledTimes(3);
});

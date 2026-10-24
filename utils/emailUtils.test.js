import { isEmailValid } from "./emailUtils.js";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnvironment,
    EMAIL_VALIDATE_MX: "false",
  };
  delete process.env.EMAIL_ALLOWED_DOMAINS;
});

afterAll(() => {
  process.env = originalEnvironment;
});

test("accepts a valid non-disposable email when no allowlist is configured", async () => {
  await expect(isEmailValid("listener@example.com")).resolves.toEqual({ error: null });
});

test("rejects malformed email addresses", async () => {
  await expect(isEmailValid("not-an-email")).resolves.toEqual({
    error: "Invalid email format",
  });
});

test("enforces an optional domain allowlist", async () => {
  process.env.EMAIL_ALLOWED_DOMAINS = "trackfusion.example";

  await expect(isEmailValid("listener@example.com")).resolves.toEqual({
    error: "Email domain not allowed",
  });
});

test("rejects known disposable email domains", async () => {
  await expect(isEmailValid("listener@mailinator.com")).resolves.toEqual({
    error: "Disposable email addresses are not allowed",
  });
});

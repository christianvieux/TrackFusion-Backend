const mockSend = jest.fn();
const mockResendConstructor = jest.fn();

jest.mock("resend", () => ({
  Resend: function MockResend(apiKey) {
    mockResendConstructor(apiKey);
    this.emails = { send: mockSend };
  },
}));

import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./emailService.js";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...originalEnvironment,
    EMAIL_DELIVERY_ENABLED: "true",
    RESEND_API_KEY: "test-resend-key",
  };
  mockSend.mockResolvedValue({ data: { id: "email-id" }, error: null });
});

afterAll(() => {
  process.env = originalEnvironment;
});

test("does not create a provider client when delivery is disabled", async () => {
  process.env.EMAIL_DELIVERY_ENABLED = "false";

  await sendVerificationEmail("listener@example.com", "123456");

  expect(mockResendConstructor).not.toHaveBeenCalled();
  expect(mockSend).not.toHaveBeenCalled();
});

test("sends verification email through Resend with the verified sender", async () => {
  await sendVerificationEmail("listener@example.com", "123456");

  expect(mockResendConstructor).toHaveBeenCalledWith("test-resend-key");
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({
      from: "TrackFusionWeb <verify@mail.trackfusionweb.com>",
      to: "listener@example.com",
      subject: "Verify your TrackFusionWeb email",
    }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test("returns a sanitized error when Resend rejects delivery", async () => {
  mockSend.mockResolvedValue({
    data: null,
    error: { message: "provider details", statusCode: 429 },
  });

  await expect(
    sendPasswordResetEmail(
      "listener@example.com",
      "https://www.trackfusionweb.com/reset-password/private-token",
    ),
  ).rejects.toMatchObject({
    message: "Transactional email delivery failed",
    code: "EMAIL_DELIVERY_FAILED",
    statusCode: 429,
  });
});

test("sanitizes network errors thrown by the provider SDK", async () => {
  mockSend.mockRejectedValue(new Error("request included private contents"));

  await expect(
    sendVerificationEmail("listener@example.com", "123456"),
  ).rejects.toMatchObject({
    message: "Transactional email delivery failed",
    code: "EMAIL_DELIVERY_FAILED",
  });
});

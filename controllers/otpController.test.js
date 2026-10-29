import { verifyOtp } from "./otpController.js";

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("verifyOtp validation", () => {
  it("returns a client-friendly message for a short verification code", async () => {
    const req = {
      body: {
        email: "listener@example.com",
        purpose: "registration",
        otp_code: "123",
      },
    };
    const res = createResponse();

    await verifyOtp(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Verification code must be exactly 6 digits",
    });
  });

  it("explains that a verification code may only contain numbers", async () => {
    const req = {
      body: {
        email: "listener@example.com",
        purpose: "registration",
        otp_code: "12ab56",
      },
    };
    const res = createResponse();

    await verifyOtp(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Verification code must contain only numbers",
    });
  });
});

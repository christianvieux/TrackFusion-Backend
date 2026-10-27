const mockCompleteRegistration = jest.fn();
const mockEstablishUserSession = jest.fn();

jest.mock("../services/registrationService.js", () => ({
  completeRegistration: (...args) => mockCompleteRegistration(...args),
}));
jest.mock("./authController.js", () => ({
  establishUserSession: (...args) => mockEstablishUserSession(...args),
}));

import { register } from "./registrationController.js";

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("uses the server-side verified registration session for legacy clients", async () => {
  const user = { id: 7, username: "listener", email: "listener@example.com" };
  const req = {
    body: {
      email: "listener@example.com",
      username: "listener",
      password: "password123",
      otp_code: "123456",
    },
    session: {
      registration: {
        email: "listener@example.com",
        registrationGrant: "session-registration-grant",
      },
    },
  };
  const res = createResponse();
  mockCompleteRegistration.mockResolvedValue(user);
  mockEstablishUserSession.mockReturnValue(user);

  await register(req, res);

  expect(mockCompleteRegistration).toHaveBeenCalledWith({
    email: "listener@example.com",
    username: "listener",
    password: "password123",
    registrationGrant: "session-registration-grant",
  });
  expect(req.session.registration).toBeUndefined();
  expect(mockEstablishUserSession).toHaveBeenCalledWith(req, res, user);
  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ user, result: user }),
  );
});

test("accepts an explicit grant for non-browser clients", async () => {
  const user = { id: 8, username: "api-user", email: "api@example.com" };
  const req = {
    body: {
      email: "api@example.com",
      username: "api-user",
      password: "password123",
      registration_grant: "explicit-registration-grant",
    },
    session: {},
  };
  const res = createResponse();
  mockCompleteRegistration.mockResolvedValue(user);
  mockEstablishUserSession.mockReturnValue(user);

  await register(req, res);

  expect(mockCompleteRegistration).toHaveBeenCalledWith(
    expect.objectContaining({ registrationGrant: "explicit-registration-grant" }),
  );
});

test("returns a safe conflict for duplicate username or email", async () => {
  const req = {
    body: { email: "api@example.com", username: "api-user", password: "password123" },
    session: {},
  };
  const res = createResponse();
  mockCompleteRegistration.mockRejectedValue(
    Object.assign(new Error("constraint details"), { code: "23505" }),
  );

  await register(req, res);

  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({
    error: "Username or email already exists",
  });
});

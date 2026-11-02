const mockComparePassword = jest.fn();
const mockGetUserInfo = jest.fn();

jest.mock("../services/dbService.js", () => ({
  queryToDatabase: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.mock("../utils/passwordUtils.js", () => ({
  comparePassword: (...args) => mockComparePassword(...args),
  hashPassword: jest.fn(),
}));
jest.mock("../controllers/userController.js", () => ({
  getUserInfo: (...args) => mockGetUserInfo(...args),
  getUserById: jest.fn(),
}));
jest.mock("../services/emailService.js", () => ({
  sendPasswordChangedEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));

import { login } from "./authController.js";

const originalJwtSecret = process.env.JWT_SECRET;

function createResponse() {
  return {
    cookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = "login-test-jwt-secret";
});

afterAll(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

test("preserves the login session and response contract without track data", async () => {
  mockGetUserInfo.mockResolvedValue({
    id: 7,
    username: "listener",
    email: "listener@example.com",
    password_hash: "password-hash",
  });
  mockComparePassword.mockResolvedValue(true);
  const req = {
    body: { email: "listener@example.com", password: "password123" },
    session: {},
  };
  const res = createResponse();

  await login(req, res);

  expect(mockGetUserInfo).toHaveBeenCalledWith("listener@example.com");
  expect(mockComparePassword).toHaveBeenCalledWith(
    "password123",
    "password-hash",
  );
  expect(req.session.user).toEqual({
    id: 7,
    username: "listener",
    email: "listener@example.com",
  });
  expect(res.cookie).toHaveBeenCalledWith(
    "token",
    expect.any(String),
    expect.any(Object),
  );
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    message: "Login successful",
    user: req.session.user,
  });
});

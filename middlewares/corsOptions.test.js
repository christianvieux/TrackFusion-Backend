const originalEnvironment = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnvironment,
    NODE_ENV: "production",
    FRONTEND_URL: "https://trackfusionweb.vercel.app",
    CORS_ALLOWED_ORIGINS: "https://trackfusionweb.vercel.app",
  };
});

afterAll(() => {
  process.env = originalEnvironment;
});

test("allows the exact production frontend with credentials", async () => {
  const { corsOptions } = await import("./corsOptions.js");
  const callback = jest.fn();

  corsOptions.origin("https://trackfusionweb.vercel.app", callback);

  expect(callback).toHaveBeenCalledWith(null, true);
  expect(corsOptions.credentials).toBe(true);
});

test("rejects an unlisted browser origin", async () => {
  const { corsOptions } = await import("./corsOptions.js");
  const callback = jest.fn();

  corsOptions.origin("https://untrusted.example", callback);

  expect(callback).toHaveBeenCalledTimes(1);
  const [error] = callback.mock.calls[0];
  expect(error).toMatchObject({
    message: "Origin not allowed by CORS",
    status: 403,
    code: "CORS_ORIGIN_DENIED",
  });
});

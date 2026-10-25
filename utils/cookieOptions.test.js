const originalEnvironment = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnvironment,
    NODE_ENV: "production",
    COOKIE_SECURE: "true",
    COOKIE_SAME_SITE: "none",
  };
  delete process.env.COOKIE_DOMAIN;
});

afterAll(() => {
  process.env = originalEnvironment;
});

test("uses host-only secure cross-site cookies in production", async () => {
  const { sessionCookieOptions, tokenCookieOptions } = await import("./cookieOptions.js");

  for (const options of [sessionCookieOptions, tokenCookieOptions]) {
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
    expect(options).not.toHaveProperty("domain");
  }
});

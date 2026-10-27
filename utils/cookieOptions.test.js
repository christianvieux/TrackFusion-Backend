const originalEnvironment = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnvironment,
    NODE_ENV: "production",
    COOKIE_SECURE: "true",
    COOKIE_SAME_SITE: "lax",
  };
  delete process.env.COOKIE_DOMAIN;
});

afterAll(() => {
  process.env = originalEnvironment;
});

test("uses host-only secure same-site cookies in production", async () => {
  const { sessionCookieOptions, tokenCookieOptions } = await import("./cookieOptions.js");

  for (const options of [sessionCookieOptions, tokenCookieOptions]) {
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(options).not.toHaveProperty("domain");
  }
});

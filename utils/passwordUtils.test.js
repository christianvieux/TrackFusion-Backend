import { comparePassword, hashPassword } from "./passwordUtils.js";

test("hashes passwords and verifies only the matching plaintext", async () => {
  const hash = await hashPassword("correct horse battery staple");

  expect(hash).not.toContain("correct horse battery staple");
  await expect(comparePassword("correct horse battery staple", hash)).resolves.toBe(true);
  await expect(comparePassword("wrong password", hash)).resolves.toBe(false);
});

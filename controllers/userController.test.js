const mockQueryToDatabase = jest.fn();

jest.mock("../services/dbService.js", () => ({
  queryToDatabase: (...args) => mockQueryToDatabase(...args),
}));
jest.mock("../services/mediaUrlService.js", () => ({
  authorizeMediaReference: jest.fn(),
  authorizeTrackArtworkList: jest.fn(),
}));

import { getUserInfo } from "./userController.js";

beforeEach(() => {
  jest.clearAllMocks();
});

test("loads only the account row needed for authentication", async () => {
  const user = {
    id: 7,
    username: "listener",
    email: "listener@example.com",
    password_hash: "password-hash",
  };
  mockQueryToDatabase.mockResolvedValue({ rows: [user] });

  await expect(getUserInfo(" Listener@Example.com ")).resolves.toBe(user);

  expect(mockQueryToDatabase).toHaveBeenCalledTimes(1);
  expect(mockQueryToDatabase).toHaveBeenCalledWith(
    "SELECT * FROM users WHERE LOWER(email) = $1",
    ["listener@example.com"],
  );
  expect(user).not.toHaveProperty("favoriteTracks");
  expect(user).not.toHaveProperty("ownedTracks");
});

test("returns null without making related-track queries for an unknown account", async () => {
  mockQueryToDatabase.mockResolvedValue({ rows: [] });

  await expect(getUserInfo("missing@example.com")).resolves.toBeNull();
  expect(mockQueryToDatabase).toHaveBeenCalledTimes(1);
});

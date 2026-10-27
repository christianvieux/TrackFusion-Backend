import { buildUploadJobOptions, isFinalJobAttempt } from "./uploadJobPolicy.js";

test("deduplicates retries for the same user upload key", () => {
  const first = buildUploadJobOptions("track", 42, "uploads/42/example.wav");
  const repeated = buildUploadJobOptions("track", 42, "uploads/42/example.wav");
  const otherUser = buildUploadJobOptions("track", 7, "uploads/7/example.wav");

  expect(first).toEqual(repeated);
  expect(first.jobId).not.toBe(otherUser.jobId);
  expect(first).toMatchObject({
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
  });
});

test("retains staging data until the final failed attempt", () => {
  expect(isFinalJobAttempt({ attemptsMade: 0, opts: { attempts: 3 } })).toBe(false);
  expect(isFinalJobAttempt({ attemptsMade: 1, opts: { attempts: 3 } })).toBe(false);
  expect(isFinalJobAttempt({ attemptsMade: 2, opts: { attempts: 3 } })).toBe(true);
});

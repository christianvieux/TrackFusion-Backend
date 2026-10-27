import crypto from "crypto";

export function buildUploadJobOptions(kind, userId, key) {
  const digest = crypto
    .createHash("sha256")
    .update(`${kind}\0${userId}\0${key}`)
    .digest("hex")
    .slice(0, 32);

  return {
    jobId: `${kind}-${digest}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
  };
}

export function isFinalJobAttempt(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts || 1);
}

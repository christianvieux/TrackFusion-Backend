import sharp from "sharp";
import dotenv from "dotenv";

dotenv.config();

const apiBaseUrl =
  process.env.API_BASE_URL ||
  `http://127.0.0.1:${process.env.LOCAL_API_PORT || 8081}`;
const mailpitBaseUrl =
  process.env.MAILPIT_BASE_URL ||
  `http://127.0.0.1:${process.env.LOCAL_MAILPIT_UI_PORT || 8025}`;
const uniqueSuffix = Date.now().toString(36);
const email = `registration-${uniqueSuffix}@example.com`;
const username = `e2e_${uniqueSuffix}`.slice(0, 20);
const initialPassword = `Local-${uniqueSuffix}-password`;
const resetPassword = `Reset-${uniqueSuffix}-password`;
const cookies = new Map();

function updateCookies(response) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function rawApiRequest(
  path,
  { method = "GET", body, useCookies = true, captureCookies = useCookies } = {},
) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(useCookies && cookies.size ? { Cookie: cookieHeader() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (captureCookies) updateCookies(response);
  const payload = await response.json();
  return { response, payload };
}

async function apiRequest(path, options) {
  const { response, payload } = await rawApiRequest(path, options);
  if (!response.ok) {
    throw new Error(
      `${options?.method || "GET"} ${path} failed with HTTP ${response.status}: ${payload.error}`,
    );
  }
  return { response, payload };
}

async function findCapturedMessage(subject, afterTime, recipient = email) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${mailpitBaseUrl}/api/v1/messages`);
    if (!response.ok) throw new Error(`Mailpit API failed with HTTP ${response.status}`);
    const inbox = await response.json();
    const summary = inbox.messages.find(
      (message) =>
        message.Subject === subject &&
        JSON.stringify(message.To).includes(recipient) &&
        new Date(message.Created).getTime() >= afterTime,
    );
    if (summary) {
      const detailResponse = await fetch(
        `${mailpitBaseUrl}/api/v1/message/${summary.ID}`,
      );
      if (!detailResponse.ok) {
        throw new Error(`Mailpit message lookup failed with HTTP ${detailResponse.status}`);
      }
      return detailResponse.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Mailpit did not capture: ${subject}`);
}

async function createUpload(fileName, contentType, body) {
  const { payload: upload } = await apiRequest("/aws/presigned-url", {
    method: "POST",
    body: { fileName, contentType },
  });
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Browser upload failed with HTTP ${uploadResponse.status}`);
  }
  return upload;
}

async function waitForUpload(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { payload } = await apiRequest(path);
    if (payload.state === "completed") return payload.result;
    if (payload.state === "failed") {
      throw new Error(`Media worker failed: ${payload.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Media worker verification timed out");
}

function createWavBuffer() {
  const sampleRate = 44_100;
  const sampleCount = sampleRate;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = Math.sin((2 * Math.PI * 440 * sample) / sampleRate);
    buffer.writeInt16LE(Math.round(value * 8_000), 44 + sample * 2);
  }
  return buffer;
}

const registrationRequestedAt = Date.now() - 1_000;
await apiRequest("/otp/generate", {
  method: "POST",
  body: { email, purpose: "registration" },
});
const verificationMessage = await findCapturedMessage(
  "Verify your TrackFusionWeb email",
  registrationRequestedAt,
);
const otpCode = verificationMessage.Text.match(/\b\d{6}\b/)?.[0];
if (!otpCode) throw new Error("Registration email did not contain a verification code");

const verification = await apiRequest("/otp/verify", {
  method: "POST",
  body: { email, otp_code: otpCode, purpose: "registration" },
});
if (!verification.payload.registrationGrant) {
  throw new Error("OTP verification did not return a registration grant");
}

const registration = await apiRequest("/users/register", {
  method: "POST",
  body: { email, username, password: initialPassword, otp_code: otpCode },
});
if (registration.response.status !== 201 || registration.payload.user?.email !== email) {
  throw new Error("Registration did not create an authenticated user");
}

const session = await apiRequest("/auth/session");
if (session.payload.user?.email !== email) {
  throw new Error("Registration session was not authenticated");
}

await apiRequest("/auth/logout", { method: "POST" });
cookies.clear();
await apiRequest("/auth/login", {
  method: "POST",
  body: { email, password: initialPassword },
});

const resetRequestedAt = Date.now() - 1_000;
await apiRequest("/auth/forgot-password", {
  method: "POST",
  body: { email },
});
const resetMessage = await findCapturedMessage(
  "Reset your TrackFusionWeb password",
  resetRequestedAt,
);
const resetToken = resetMessage.Text.match(/\/reset-password\/([A-Za-z0-9_-]+)/)?.[1];
if (!resetToken) throw new Error("Password-reset email did not contain a reset token");

await apiRequest(`/auth/verify-reset-token/${resetToken}`);
await apiRequest(`/auth/reset-password/${resetToken}`, {
  method: "POST",
  body: { password: resetPassword },
});
await apiRequest("/auth/logout", { method: "POST" });
cookies.clear();
const finalLogin = await apiRequest("/auth/login", {
  method: "POST",
  body: { email, password: resetPassword },
});

const profileImage = await sharp({
  create: {
    width: 256,
    height: 256,
    channels: 3,
    background: { r: 65, g: 38, b: 120 },
  },
}).png().toBuffer();
const imageUpload = await createUpload("profile.png", "image/png", profileImage);
const profileJob = await apiRequest("/upload/profile-picture", {
  method: "POST",
  body: { imageUrl: imageUpload },
});
const profileUrl = await waitForUpload(
  `/upload/profile-picture-status/${profileJob.payload.jobId}`,
);
const profileResponse = await fetch(profileUrl);
if (!profileResponse.ok || (await profileResponse.arrayBuffer()).byteLength === 0) {
  throw new Error("Processed profile picture was not browser-accessible");
}

const wavUpload = await createUpload("verification.wav", "audio/wav", createWavBuffer());
const trackJob = await apiRequest("/upload/track", {
  method: "POST",
  body: {
    trackUrl: wavUpload,
    name: "Local portability verification",
    artist: "TrackFusionWeb",
    description: "Local-only integration check",
    is_private: false,
    category: "Music",
    genre: "Pop",
    mood: "Happy",
    bpm: 120,
  },
});
const track = await waitForUpload(`/upload/track-status/${trackJob.payload.jobId}`);
const playback = await apiRequest(`/tracks/${track.id}/authorized-url`);
const audioResponse = await fetch(playback.payload.url);
if (!audioResponse.ok || (await audioResponse.arrayBuffer()).byteLength < 44) {
  throw new Error("Processed audio track was not browser-accessible");
}

const publicProfile = await apiRequest(
  `/users/info/${finalLogin.payload.user.id}`,
);
if (!publicProfile.payload.profile_picture_url) {
  throw new Error("Profile picture reference was not persisted");
}

const invalidEmail = await rawApiRequest("/otp/generate", {
  method: "POST",
  body: { email: "not-an-email", purpose: "registration" },
});
if (invalidEmail.response.status !== 400) {
  throw new Error("Invalid registration email was not rejected");
}

const concurrentEmail = `concurrent-${uniqueSuffix}@example.com`;
const concurrentRequestedAt = Date.now() - 1_000;
await apiRequest("/otp/generate", {
  method: "POST",
  body: { email: concurrentEmail, purpose: "registration" },
});
const cooldown = await rawApiRequest("/otp/generate", {
  method: "POST",
  body: { email: concurrentEmail, purpose: "registration" },
});
if (cooldown.response.status !== 429) {
  throw new Error("Registration resend cooldown was not enforced");
}
const concurrentMessage = await findCapturedMessage(
  "Verify your TrackFusionWeb email",
  concurrentRequestedAt,
  concurrentEmail,
);
const concurrentCode = concurrentMessage.Text.match(/\b\d{6}\b/)?.[0];
const concurrentVerification = await apiRequest("/otp/verify", {
  method: "POST",
  body: {
    email: concurrentEmail,
    otp_code: concurrentCode,
    purpose: "registration",
  },
});
const replay = await rawApiRequest("/otp/verify", {
  method: "POST",
  body: {
    email: concurrentEmail,
    otp_code: concurrentCode,
    purpose: "registration",
  },
});
if (replay.response.status !== 400) {
  throw new Error("Consumed verification code was reusable");
}

const concurrentBody = {
  email: concurrentEmail,
  username: `race_${uniqueSuffix}`.slice(0, 20),
  password: initialPassword,
  registration_grant: concurrentVerification.payload.registrationGrant,
};
const concurrentResults = await Promise.all([
  rawApiRequest("/users/register", {
    method: "POST",
    body: concurrentBody,
    useCookies: false,
  }),
  rawApiRequest("/users/register", {
    method: "POST",
    body: concurrentBody,
    useCookies: false,
  }),
]);
const concurrentStatuses = concurrentResults
  .map(({ response }) => response.status)
  .sort((left, right) => left - right);
if (concurrentStatuses.join(",") !== "201,400") {
  throw new Error(`Concurrent registration was not single-use: ${concurrentStatuses}`);
}

const duplicateEmail = `duplicate-${uniqueSuffix}@example.com`;
const duplicateRequestedAt = Date.now() - 1_000;
await apiRequest("/otp/generate", {
  method: "POST",
  body: { email: duplicateEmail, purpose: "registration" },
});
const duplicateMessage = await findCapturedMessage(
  "Verify your TrackFusionWeb email",
  duplicateRequestedAt,
  duplicateEmail,
);
const duplicateCode = duplicateMessage.Text.match(/\b\d{6}\b/)?.[0];
const duplicateVerification = await apiRequest("/otp/verify", {
  method: "POST",
  body: {
    email: duplicateEmail,
    otp_code: duplicateCode,
    purpose: "registration",
  },
});
const duplicateUsername = await rawApiRequest("/users/register", {
  method: "POST",
  body: {
    email: duplicateEmail,
    username,
    password: initialPassword,
    registration_grant: duplicateVerification.payload.registrationGrant,
  },
  useCookies: false,
});
if (duplicateUsername.response.status !== 409) {
  throw new Error("Duplicate username was not rejected by the database");
}
const retryAfterConflict = await rawApiRequest("/users/register", {
  method: "POST",
  body: {
    email: duplicateEmail,
    username: `retry_${uniqueSuffix}`.slice(0, 20),
    password: initialPassword,
    registration_grant: duplicateVerification.payload.registrationGrant,
  },
  useCookies: false,
});
if (retryAfterConflict.response.status !== 201) {
  throw new Error("Failed registration consumed its registration grant");
}

const attemptEmail = `attempts-${uniqueSuffix}@example.com`;
const attemptsRequestedAt = Date.now() - 1_000;
await apiRequest("/otp/generate", {
  method: "POST",
  body: { email: attemptEmail, purpose: "registration" },
});
const attemptMessage = await findCapturedMessage(
  "Verify your TrackFusionWeb email",
  attemptsRequestedAt,
  attemptEmail,
);
const attemptCode = attemptMessage.Text.match(/\b\d{6}\b/)?.[0];
const invalidAttemptCode = attemptCode === "000000" ? "000001" : "000000";
for (let attempt = 0; attempt < 5; attempt += 1) {
  const invalidAttempt = await rawApiRequest("/otp/verify", {
    method: "POST",
    body: {
      email: attemptEmail,
      otp_code: invalidAttemptCode,
      purpose: "registration",
    },
  });
  if (invalidAttempt.response.status !== 400) {
    throw new Error("Invalid verification code attempt was not rejected");
  }
}
const limitedOtp = await rawApiRequest("/otp/verify", {
  method: "POST",
  body: { email: attemptEmail, otp_code: attemptCode, purpose: "registration" },
});
if (limitedOtp.response.status !== 400) {
  throw new Error("Verification code remained usable after the attempt limit");
}

console.log(JSON.stringify({
  registration: true,
  authenticatedSession: true,
  logoutAndLogin: true,
  localEmailCapture: true,
  passwordReset: true,
  profileUpload: true,
  audioUpload: true,
  workerProcessing: true,
  signedMediaRetrieval: true,
  invalidEmailRejected: true,
  otpReplayRejected: true,
  otpAttemptLimit: true,
  resendCooldown: true,
  concurrentRegistrationSingleUse: true,
  duplicateUsernameRejected: true,
  failedTransactionRolledBack: true,
}));

import dotenv from "dotenv";

dotenv.config();

const baseUrl =
  process.env.API_BASE_URL ||
  `http://127.0.0.1:${process.env.LOCAL_API_PORT || process.env.PORT || 8081}`;

const checks = [
  { path: "/health", validate: (body) => body.status === "healthy" },
  { path: "/auth/session", validate: (body) => "user" in body },
  { path: "/tracks/public", validate: (body) => Array.isArray(body) },
  {
    path: "/enums/trackAttributes",
    validate: (body) => body && typeof body === "object",
  },
];

for (const check of checks) {
  const response = await fetch(`${baseUrl}${check.path}`);
  const body = await response.json();

  if (!response.ok || !check.validate(body)) {
    console.error(`Smoke check failed: GET ${check.path} returned ${response.status}`);
    process.exit(1);
  }

  console.log(`Smoke check passed: GET ${check.path}`);
}

console.log("TrackFusionWeb API smoke test passed");

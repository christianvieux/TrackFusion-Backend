import {
  belongsToUserUpload,
  resolveStorageConfig,
  S3Service,
} from "./s3Service.js";

const localEnvironment = {
  STORAGE_PROVIDER: "s3-compatible",
  STORAGE_REGION: "us-east-1",
  STORAGE_BUCKET: "trackfusionweb-local",
  STORAGE_ENDPOINT: "http://storage:8333",
  STORAGE_PUBLIC_ENDPOINT: "http://127.0.0.1:9000",
  STORAGE_ACCESS_KEY_ID: "trackfusion-local",
  STORAGE_SECRET_ACCESS_KEY: "trackfusion-local-secret",
};

test("selects AWS S3 without static credentials or a custom endpoint", () => {
  expect(
    resolveStorageConfig({
      STORAGE_PROVIDER: "aws-s3",
      AWS_REGION: "us-east-1",
      AWS_S3_BUCKET: "production-bucket",
    }),
  ).toEqual({
    provider: "aws-s3",
    region: "us-east-1",
    bucket: "production-bucket",
    forcePathStyle: false,
  });
});

test("selects explicit local credentials and path-style addressing", () => {
  expect(resolveStorageConfig(localEnvironment)).toEqual({
    provider: "s3-compatible",
    region: "us-east-1",
    bucket: "trackfusionweb-local",
    endpoint: "http://storage:8333",
    publicEndpoint: "http://127.0.0.1:9000",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "trackfusion-local",
      secretAccessKey: "trackfusion-local-secret",
    },
  });
});

test("rejects incomplete local storage instead of falling back to AWS", () => {
  expect(() =>
    resolveStorageConfig({
      ...localEnvironment,
      STORAGE_ENDPOINT: "",
    }),
  ).toThrow("Missing required environment variable: STORAGE_ENDPOINT");
});

test("creates browser-compatible signed URLs without evaluating AWS SSO", async () => {
  const service = new S3Service(localEnvironment);

  const result = await service.getPresignedUploadUrl(42, {
    fileName: "demo track.mp3",
    contentType: "audio/mpeg",
    folder: "uploads",
  });

  const signedUrl = new URL(result.uploadUrl);
  expect(signedUrl.origin).toBe("http://127.0.0.1:9000");
  expect(signedUrl.pathname).toContain("/trackfusionweb-local/uploads/42/");
  expect(signedUrl.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]+$/);
  expect(signedUrl.searchParams.has("x-amz-checksum-crc32")).toBe(false);
  expect(result.key).toMatch(/^uploads\/42\/\d+-demo_track\.mp3$/);
  expect(result.publicUrl).toBe(result.key);
});

test("reads both stable keys and legacy AWS URLs", () => {
  const service = new S3Service(localEnvironment);

  expect(service.getKeyFromPublicUrl("tracks/4/example.mp3")).toBe(
    "tracks/4/example.mp3",
  );
  expect(
    service.getKeyFromPublicUrl(
      "https://production-bucket.s3.amazonaws.com/tracks/4/example.mp3",
    ),
  ).toBe("tracks/4/example.mp3");
  expect(
    service.getKeyFromPublicUrl(
      "http://127.0.0.1:9000/trackfusionweb-local/tracks/4/example.mp3",
    ),
  ).toBe("tracks/4/example.mp3");
});

test("restricts staging keys to the authenticated user's prefix", () => {
  expect(belongsToUserUpload("uploads/42/example.mp3", 42)).toBe(true);
  expect(belongsToUserUpload("uploads/7/example.mp3", 42)).toBe(false);
  expect(belongsToUserUpload("tracks/42/example.mp3", 42)).toBe(false);
});

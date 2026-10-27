import dotenv from "dotenv";

dotenv.config();

const { s3Service } = await import("../services/s3Service.js");

const expectedBody = "TrackFusionWeb portable storage verification";
const upload = await s3Service.getPresignedUploadUrl("verification", {
  fileName: "storage-check.txt",
  folder: "uploads",
  contentType: "text/plain",
});
let objectCreated = false;

try {
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: expectedBody,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Presigned upload failed with HTTP ${uploadResponse.status}`);
  }
  objectCreated = true;

  const metadata = await s3Service.getMetadata(upload.key);
  if (!metadata.exists || metadata.contentType !== "text/plain") {
    throw new Error("Uploaded object metadata did not match");
  }

  const downloadUrl = await s3Service.generateSecureUrl(upload.key);
  const downloadResponse = await fetch(downloadUrl);
  if (!downloadResponse.ok || (await downloadResponse.text()) !== expectedBody) {
    throw new Error("Signed object retrieval did not match");
  }

  console.log("Portable storage upload, metadata, and retrieval verification passed");
} finally {
  if (objectCreated) {
    await s3Service.deleteFile(upload.key);
    if ((await s3Service.getMetadata(upload.key)).exists) {
      throw new Error("Storage verification object was not deleted");
    }
    console.log("Storage verification object deleted");
  }
}

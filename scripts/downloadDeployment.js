import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const [bucket, objectKey, destination] = process.argv.slice(2);

if (!/^[a-z0-9.-]+$/.test(bucket || "")) {
  throw new Error("Deployment bucket name is invalid");
}

if (!/^deployments\/[0-9a-f]{40}\.tar\.gz$/.test(objectKey || "")) {
  throw new Error("Deployment object key is invalid");
}

if (!/^\/tmp\/trackfusionweb-[0-9a-f]{40}\.tar\.gz$/.test(destination || "")) {
  throw new Error("Deployment destination is invalid");
}

const client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});
const response = await client.send(new GetObjectCommand({
  Bucket: bucket,
  Key: objectKey,
}));

if (!response.Body) {
  throw new Error("Deployment object did not contain a response body");
}

await pipeline(response.Body, createWriteStream(destination, { mode: 0o600 }));
console.log("Deployment artifact downloaded");

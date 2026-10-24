import crypto from "node:crypto";
import dotenv from "dotenv";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

dotenv.config();

const region = process.env.AWS_REGION;
const bucket = process.env.AWS_S3_BUCKET;

if (!region || !bucket) {
  throw new Error("AWS_REGION and AWS_S3_BUCKET are required");
}

const client = new S3Client({ region });
const key = `deployment-check/${crypto.randomUUID()}.txt`;
const expectedBody = "TrackFusionWeb EC2 role verification";
let objectCreated = false;

try {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: expectedBody,
    ContentType: "text/plain",
  }));
  objectCreated = true;

  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
  const actualBody = await response.Body.transformToString();

  if (actualBody !== expectedBody) {
    throw new Error("S3 verification object contents did not match");
  }

  console.log("S3 put/get verification passed");
} finally {
  if (objectCreated) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log("S3 verification object deleted");
  }
}

import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream } from "fs";
import { promises as fsPromises } from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";

const FileConfig = {
  TRACK: {
    generateKey: (userId, fileId, fileName) =>
      `tracks/${userId}/${fileId}-${fileName}`,
  },
  TRACK_COVER: {
    generateKey: (userId, fileId, fileName) =>
      `covers/${userId}/${fileId}-${fileName}`,
  },
  PROFILE_PICTURE: {
    generateKey: (userId, fileId, fileName) =>
      `profiles/${userId}/${fileName}`,
  },
  ALBUM_COVER: {
    generateKey: (userId, fileId, fileName) =>
      `albums/${userId}/${fileId}-${fileName}`,
  },
};

function requiredValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeEndpoint(value, name) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  endpoint.pathname = endpoint.pathname.replace(/\/$/, "");
  return endpoint.toString().replace(/\/$/, "");
}

export function resolveStorageConfig(environment = process.env) {
  const provider = requiredValue(environment, "STORAGE_PROVIDER");
  if (!["aws-s3", "s3-compatible"].includes(provider)) {
    throw new Error("STORAGE_PROVIDER must be aws-s3 or s3-compatible");
  }

  const region =
    environment.STORAGE_REGION?.trim() || requiredValue(environment, "AWS_REGION");
  const bucket =
    environment.STORAGE_BUCKET?.trim() || requiredValue(environment, "AWS_S3_BUCKET");

  if (provider === "aws-s3") {
    return { provider, region, bucket, forcePathStyle: false };
  }

  const endpoint = normalizeEndpoint(
    requiredValue(environment, "STORAGE_ENDPOINT"),
    "STORAGE_ENDPOINT",
  );
  const publicEndpoint = normalizeEndpoint(
    requiredValue(environment, "STORAGE_PUBLIC_ENDPOINT"),
    "STORAGE_PUBLIC_ENDPOINT",
  );

  return {
    provider,
    region,
    bucket,
    endpoint,
    publicEndpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredValue(environment, "STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: requiredValue(environment, "STORAGE_SECRET_ACCESS_KEY"),
    },
  };
}

function clientOptions(config, endpoint) {
  const options = {
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  if (endpoint) options.endpoint = endpoint;
  if (config.credentials) options.credentials = config.credentials;
  return options;
}

export class S3Service {
  constructor(environment = process.env) {
    this.environment = environment;
    this.config = resolveStorageConfig(environment);
    this.bucket = this.config.bucket;
    this.client = new S3Client(clientOptions(this.config, this.config.endpoint));
    this.signingClient =
      this.config.publicEndpoint &&
      this.config.publicEndpoint !== this.config.endpoint
        ? new S3Client(clientOptions(this.config, this.config.publicEndpoint))
        : this.client;
  }

  inferContentType(fileName) {
    const extension = fileName.toLowerCase().split(".").pop();
    const contentTypeMap = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/x-m4a",
      ogg: "audio/ogg",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    return contentTypeMap[extension] || "application/octet-stream";
  }

  async generatePresignedUrl(key, contentType, expiresIn = 3600) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.signingClient, command, { expiresIn });
  }

  async getPresignedUploadUrl(userId, { fileName, folder, contentType }) {
    if (!fileName) throw new Error("File name is required");
    if (!folder) throw new Error("Folder path is required");

    const key = this.generateKey(folder, userId, fileName);
    const uploadUrl = await this.generatePresignedUrl(
      key,
      contentType || this.inferContentType(fileName),
    );
    return { key, uploadUrl, publicUrl: key };
  }

  getPublicUrl(key) {
    if (!key) throw new Error("Key is required");
    return key;
  }

  getKeyFromPublicUrl(reference) {
    if (!reference) throw new Error("Storage object reference is required");
    if (!reference.includes("://")) return reference.replace(/^\/+/, "");

    const parsed = new URL(reference);
    let key = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    if (key.startsWith(`${this.bucket}/`)) {
      key = key.slice(this.bucket.length + 1);
    }
    return key;
  }

  async downloadToTemp(key) {
    let tempFilePath = null;
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      tempFilePath = path.join(
        os.tmpdir(),
        `storage_${Date.now()}_${path.basename(key)}`,
      );

      if (response.Body instanceof Readable) {
        await this._streamToFile(response.Body, tempFilePath);
      } else {
        await fsPromises.writeFile(
          tempFilePath,
          await response.Body.transformToByteArray(),
        );
      }

      return {
        filePath: tempFilePath,
        contentType: response.ContentType,
        metadata: response.Metadata,
      };
    } catch (error) {
      if (tempFilePath) await fsPromises.unlink(tempFilePath).catch(() => {});
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  async uploadFile(localFilePath, key, contentType) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: await fsPromises.readFile(localFilePath),
          ContentType: contentType,
        }),
      );
      return this.getPublicUrl(key);
    } catch (error) {
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  async deleteFile(key) {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  async getMetadata(key) {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        exists: true,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        metadata: response.Metadata,
      };
    } catch (error) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      throw error;
    }
  }

  generateKey(folder, userId, fileName) {
    const sanitizedFileName = path.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    return `${folder}/${userId}/${Date.now()}-${sanitizedFileName}`;
  }

  async testConnection() {
    const testKey = `health/storage-${Date.now()}`;
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: testKey, Body: "test" }),
      );
      await this.deleteFile(testKey);
      return true;
    } catch {
      return false;
    }
  }

  async initializeBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (
        !["NotFound", "NoSuchBucket"].includes(error.name) &&
        error.$metadata?.httpStatusCode !== 404
      ) {
        throw error;
      }
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }

    const allowedOrigins = (this.environment.STORAGE_CORS_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (allowedOrigins.length > 0) {
      await this.client.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: allowedOrigins,
                AllowedMethods: ["GET", "HEAD", "PUT"],
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag"],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    }
  }

  async _streamToFile(stream, filePath) {
    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(filePath);
      stream.pipe(writeStream).on("finish", resolve).on("error", reject);
      writeStream.on("error", (error) => {
        stream.destroy();
        reject(error);
      });
    });
  }

  async copyFile(sourceKey, destinationKey) {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${sourceKey}`,
          Key: destinationKey,
        }),
      );
      return this.getPublicUrl(destinationKey);
    } catch (error) {
      throw new Error(`Failed to copy file: ${error.message}`);
    }
  }

  async finalizeUpload(uploadKey, userId, fileType, fileId = null) {
    const fileInfo = await this.getMetadata(uploadKey);
    if (!fileInfo.exists) throw new Error("Upload file not found");

    const config = FileConfig[fileType];
    if (!config) throw new Error(`Unsupported file type: ${fileType}`);

    const fileName = uploadKey.split("/").pop();
    const destinationKey = config.generateKey(userId, fileId, fileName);
    // Keep the staging object until the surrounding job commits its database
    // changes. This makes Bull retries durable instead of losing their source.
    const finalReference = await this.copyFile(uploadKey, destinationKey);
    return { key: destinationKey, url: finalReference, metadata: fileInfo };
  }

  finalizeTrackUpload(uploadKey, userId, trackId) {
    return this.finalizeUpload(uploadKey, userId, "TRACK", trackId);
  }

  finalizeProfilePictureUpload(uploadKey, userId) {
    return this.finalizeUpload(uploadKey, userId, "PROFILE_PICTURE");
  }

  finalizeCoverArtUpload(uploadKey, userId, trackId) {
    return this.finalizeUpload(uploadKey, userId, "TRACK_COVER", trackId);
  }

  finalizeAlbumCoverUpload(uploadKey, userId, albumId) {
    return this.finalizeUpload(uploadKey, userId, "ALBUM_COVER", albumId);
  }

  async generateSecureUrl(keyOrReference, expiresIn = 3600) {
    const key = this.getKeyFromPublicUrl(keyOrReference);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.signingClient, command, { expiresIn });
  }

  getTrackPlaybackUrl(trackReference, expiresIn = 3600) {
    if (!trackReference) throw new Error("Track reference is required");
    return this.generateSecureUrl(trackReference, expiresIn);
  }
}

export function belongsToUserUpload(key, userId) {
  return typeof key === "string" && key.startsWith(`uploads/${userId}/`);
}

let defaultService;

export function getS3Service() {
  if (!defaultService) defaultService = new S3Service();
  return defaultService;
}

// Keep the existing import contract while delaying client construction until a
// storage operation actually runs. Startup configuration validation still
// rejects incomplete provider settings before routes are loaded.
export const s3Service = new Proxy({}, {
  get(_target, property) {
    const value = getS3Service()[property];
    return typeof value === "function" ? value.bind(getS3Service()) : value;
  },
});

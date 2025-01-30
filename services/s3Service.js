// utils/s3Service.js
import { 
  S3Client, 
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import { promises as fsPromises } from 'fs';
import dotenv from "dotenv";
import path from 'path';
import os from 'os';

dotenv.config();

const FileConfig = {
  TRACK: {
    folder: 'tracks',
    generateKey: (userId, fileId, fileName) => 
      `tracks/${userId}/${Date.now()}-${fileId}-${fileName}`
  },
  TRACK_COVER: {
    folder: 'covers',
    generateKey: (userId, fileId, fileName) => 
      `covers/${userId}/${Date.now()}-${fileId}-${fileName}`
  },
  PROFILE_PICTURE: {
    folder: 'profiles',
    generateKey: (userId, fileId, fileName) => 
      `profiles/${userId}/${Date.now()}-${fileName}`
  },
  ALBUM_COVER: {
    folder: 'albums',
    generateKey: (userId, fileId, fileName) => 
      `albums/${userId}/${Date.now()}-${fileId}-${fileName}`
  }
};

class S3Service {
  constructor() {
    this.validateEnvironment();
    this.bucket = process.env.AWS_S3_BUCKET;
    this.client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }

  validateEnvironment() {
    const required = [
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_S3_BUCKET",
    ];
    
    const missing = required.filter(key => !process.env[key]);
    if (missing.length) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
  inferContentType(fileName) {
    const extension = fileName.toLowerCase().split('.').pop();
    const contentTypeMap = {
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      
      // Audio
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'm4a': 'audio/x-m4a',
      'ogg': 'audio/ogg',
      
      // Other common types
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
  
    return contentTypeMap[extension] || 'application/octet-stream';
  }

  async generatePresignedUrl(key, contentType, expiresIn = 3600) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getPresignedUploadUrl(userId, { fileName, folder }) {
    try {
      if (!fileName) {
        throw new Error('File name is required');
      }
  
      if (!folder) {
        throw new Error('Folder path is required');
      }
  
      const key = this.generateKey(folder, userId, fileName);
      const uploadUrl = await this.generatePresignedUrl(
        key,
        this.inferContentType(fileName)
      );
  
      return {
        key,
        uploadUrl,
        publicUrl: this.getPublicUrl(key)
      };
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      throw new Error(`Failed to generate upload URL: ${error.message}`);
    }
  }

  // ------------------------------------------[[ Untested Methods ]]------------------------------------------
  getPublicUrl(key) {
    if (!key) throw new Error('Key is required');
    return `https://${this.bucket}.s3.amazonaws.com/${key}`;
  }

  getKeyFromPublicUrl(publicUrl) {
    if (!publicUrl) throw new Error('Public URL is required');
    const urlParts = publicUrl.split('.com/');
    return urlParts[urlParts.length - 1];
  }

  async downloadToTemp(key) {
    let tempFilePath = null;
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      tempFilePath = path.join(os.tmpdir(), `s3_${Date.now()}_${path.basename(key)}`);
      
      if (response.Body instanceof Readable) {
        await this._streamToFile(response.Body, tempFilePath);
      } else {
        const bodyContents = await response.Body.transformToByteArray();
        await fsPromises.writeFile(tempFilePath, bodyContents);
      }

      return {
        filePath: tempFilePath,
        contentType: response.ContentType,
        metadata: response.Metadata
      };
    } catch (error) {
      // Clean up temp file if it exists and there was an error
      if (tempFilePath) {
        await fsPromises.unlink(tempFilePath).catch(() => {});
      }
      console.error('Error downloading file:', error);
      throw new Error(`Failed to download file: ${error.message}`);
    }
  }

  async uploadFile(localFilePath, key, contentType) {
    try {
      const fileContent = await fsPromises.readFile(localFilePath);
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileContent,
        ContentType: contentType
      });

      await this.client.send(command);
      return this.getPublicUrl(key);
    } catch (error) {
      console.error('Error uploading file:', error);
      throw new Error(`Failed to upload file: ${error.message}`);
    }
  }

  async deleteFile(key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  async getMetadata(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      return {
        exists: true,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        metadata: response.Metadata
      };
    } catch (error) {
      if (error.name === 'NotFound') {
        return { exists: false };
      }
      throw error;
    }
  }

  async listFiles(prefix) {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      });
      const response = await this.client.send(command);
      return response.Contents || [];
    } catch (error) {
      console.error('Error listing files:', error);
      throw new Error(`Failed to list files: ${error.message}`);
    }
  }

  generateKey(folder, userId, fileName) {
    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `${folder}/${userId}/${timestamp}-${sanitizedFileName}`;
  }

  async testConnection() {
    try {
      const testKey = `test-connection-${Date.now()}`;
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: testKey,
          Body: "test",
        })
      );
      await this.deleteFile(testKey);
      return true;
    } catch (error) {
      console.error("Failed to connect to AWS S3:", error);
      return false;
    }
  }

  // Helper method for streaming file downloads
  async _streamToFile(stream, filePath) {
    return new Promise((resolve, reject) => {
      const writeStream = createWriteStream(filePath);
      
      stream.pipe(writeStream)
        .on('finish', resolve)
        .on('error', (error) => {
          writeStream.end();
          reject(error);
        });

      writeStream.on('error', (error) => {
        stream.destroy();
        reject(error);
      });
    });
  }

  // ------------------------------------------[[Finalize/upload ]]-------------------------------
  async moveFile(sourceKey, destinationKey) {
    try {
      const copyCommand = new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destinationKey
      });
      
      await this.client.send(copyCommand);
      await this.deleteFile(sourceKey);
      
      return this.getPublicUrl(destinationKey);
    } catch (error) {
      console.error('Error moving file:', error);
      throw new Error(`Failed to move file: ${error.message}`);
    }
  }
  
  async finalizeUpload(uploadKey, userId, fileType, fileId = null) {
    try {
      const fileInfo = await this.getMetadata(uploadKey);
      
      if (!fileInfo.exists) {
        throw new Error('Upload file not found');
      }
  
      const config = FileConfig[fileType];
      if (!config) {
        throw new Error(`Unsupported file type: ${fileType}`);
      }
  
      const fileName = uploadKey.split('/').pop();
      const destinationKey = config.generateKey(userId, fileId, fileName);
      
      const finalUrl = await this.moveFile(uploadKey, destinationKey);

      console.log("Moving file to final location:",uploadKey, finalUrl);
      
      return {
        key: destinationKey,
        url: finalUrl,
        metadata: fileInfo
      };
    } catch (error) {
      console.error('Error finalizing upload:', error);
      throw new Error(`Failed to finalize upload: ${error.message}`);
    }
  }
  
  // usage methods for specific file types
  async finalizeTrackUpload(uploadKey, userId, trackId) {
    return this.finalizeUpload(uploadKey, userId, 'TRACK', trackId);
  }
  
  async finalizeProfilePictureUpload(uploadKey, userId) {
    return this.finalizeUpload(uploadKey, userId, 'PROFILE_PICTURE');
  }
  
  async finalizeCoverArtUpload(uploadKey, userId, trackId) {
    return this.finalizeUpload(uploadKey, userId, 'TRACK_COVER', trackId);
  }
  
  async finalizeAlbumCoverUpload(uploadKey, userId, albumId) {
    return this.finalizeUpload(uploadKey, userId, 'ALBUM_COVER', albumId);
  }

  // ------------------------------------------[[ Authorization ]]------------------------------------------
  async generateSecureUrl(key, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      
      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      console.error('Error generating secure URL:', error);
      throw new Error(`Failed to generate secure URL: ${error.message}`);
    }
  }
  
  async getTrackPlaybackUrl(trackKey, expiresIn = 3600) {
    try {
      if (!trackKey) {
        throw new Error('Track key is required');
      }
      
      return this.generateSecureUrl(trackKey, expiresIn);
    } catch (error) {
      console.error('Error generating track playback URL:', error);
      throw new Error(`Failed to generate track playback URL: ${error.message}`);
    }
  }
  //------------------------------------------[[ Test ]]------------------------------------------
  async testFileProcessing(key) {
    try {
      console.log(`Testing file processing for key: ${key}`);
      const downloadResult = await this.downloadToTemp(key);
      console.log('Download successful:', downloadResult);
      
      const metadata = await this.getMetadata(key);
      console.log('File metadata:', metadata);
      
      return { downloadResult, metadata };
    } catch (error) {
      console.error('Test failed:', error);
      throw error;
    }
  }
}

export const s3Service = new S3Service();

// await s3Service.testFileProcessing('tracks/59/1737968258826-test.mp3');
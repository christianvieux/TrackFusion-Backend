// utils/imageService.js
import sharp from 'sharp';
import mime from 'mime';
import path from 'path';
import fs from 'fs/promises';
import { stat } from 'fs';

// Parse environment variables
const MAX_FILE_SIZE = parseInt(process.env.IMAGE_MAX_FILE_SIZE || 50) * 1024 * 1024; // Convert MB to bytes
const VALID_IMAGE_TYPES = new Set(
  (process.env.ALLOWED_IMAGE_TYPES?.split(',')
    .map(type => type.trim())
    .map(type => type.replace('image/', '')) ||
  ['jpeg', 'jpg', 'png', 'heic', 'heif'])
);

export class ImageService {
  async analyzeFile(filePath) {
    try {
      const stats = await fs.stat(filePath);
      
      // Check file size first
      console.log(stats.size, MAX_FILE_SIZE);
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
      }

      const metadata = await sharp(filePath).metadata();
      
      if (!metadata) {
        throw new Error('Invalid image file format');
      }

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        space: metadata.space,
        channels: metadata.channels,
        depth: metadata.depth,
        density: metadata.density,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation,
        size: stats.size
      };
    } catch (error) {
      console.error('Error analyzing image file:', error);
      throw new Error(`Failed to analyze image file: ${error.message}`);
    }
  }

  getFileType(filePath) {
    const extension = path.extname(filePath).toLowerCase().substring(1);
    
    // Direct extension mapping
    if (VALID_IMAGE_TYPES.has(extension)) {
      return extension;
    }

    // Use MIME type as fallback
    const mimeType = mime.getType(filePath);
    const format = mimeType?.split('/')[1];

    if (VALID_IMAGE_TYPES.has(format)) {
      return format;
    }

    throw new Error('Unsupported image format');
  }

  async validateImage(filePath, options = {}) {
    const {
      minWidth = 200,
      minHeight = 200,
      maxWidth = 5000,
      maxHeight = 5000,
      aspectRatio = null
    } = options;

    try {
      // Validate file type first
      const fileType = this.getFileType(filePath);
      if (!VALID_IMAGE_TYPES.has(fileType)) {
        throw new Error('Invalid image format');
      }

      // Get image metadata
      const metadata = await this.analyzeFile(filePath);

      // Validate dimensions
      if (metadata.width < minWidth || metadata.height < minHeight) {
        throw new Error(`Image dimensions too small. Minimum size is ${minWidth}x${minHeight} pixels`);
      }

      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        throw new Error(`Image dimensions too large. Maximum size is ${maxWidth}x${maxHeight} pixels`);
      }

      // Validate aspect ratio if specified
      if (aspectRatio) {
        const imageRatio = metadata.width / metadata.height;
        const tolerance = 0.1; // 10% tolerance for aspect ratio
        
        if (Math.abs(imageRatio - aspectRatio) > tolerance) {
          throw new Error('Image does not match required aspect ratio');
        }
      }

      return {
        isValid: true,
        metadata,
        fileType
      };
    } catch (error) {
      return {
        isValid: false,
        error: error.message
      };
    }
  }

  async normalizeImage(filePath, options = {}) {
    const {
      targetWidth = 800,
      targetHeight = 800,
      quality = 80,
      format = 'jpeg'
    } = options;

    try {
      let image = sharp(filePath);
      const metadata = await image.metadata();

      // Resize image while maintaining aspect ratio
      image = image.resize(targetWidth, targetHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });

      // Convert format if necessary
      if (format) {
        image = image[format]({
          quality,
          chromaSubsampling: '4:4:4'
        });
      }

      return {
        processor: image,
        metadata: {
          originalFormat: metadata.format,
          originalWidth: metadata.width,
          originalHeight: metadata.height,
          targetFormat: format,
          targetWidth,
          targetHeight
        }
      };
    } catch (error) {
      console.error('Error normalizing image:', error);
      throw new Error(`Failed to normalize image: ${error.message}`);
    }
  }

  async processForProfile(filePath, outputPath) {
    try {
      const { processor } = await this.normalizeImage(filePath, {
        targetWidth: 400,
        targetHeight: 400,
        quality: 85,
        format: 'jpeg'
      });

      await processor.toFile(outputPath);

      return {
        success: true,
        path: outputPath
      };
    } catch (error) {
      console.error('Error processing profile image:', error);
      throw new Error(`Failed to process profile image: ${error.message}`);
    }
  }
}

export const imageService = new ImageService();
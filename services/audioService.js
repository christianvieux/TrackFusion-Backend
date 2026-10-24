  // utils/audioService.js
  import * as mm from 'music-metadata';
  import mime from 'mime';
  import path from 'path';
  import fs from 'fs';
import { stat } from 'fs/promises';

  // Define valid sound types according to the database enum
  const VALID_SOUND_TYPES = [
      ...new Set(
          (process.env.ALLOWED_AUDIO_TYPES?.split(',')
              .map(type => type.replace('audio/', ''))
              .map(type => type === 'mpeg' ? 'mp3' : type) || 
          ['mp3', 'wav', 'ogg'])
      ),
  ];
  const MAX_DURATION = parseInt(process.env.AUDIO_MAX_LENGTH || 900); // 15 minutes in seconds
const MAX_FILE_SIZE = parseInt(process.env.AUDIO_MAX_FILE_SIZE || 300) * 1024 * 1024; // Convert MB to bytes

  export class AudioService {
    async analyzeFile(filePath) {
      try {
        const metadata = await mm.parseFile(filePath);
        
        if (!metadata.format) {
          throw new Error('Invalid audio file format');
        }

        return {
          duration: Math.floor(metadata.format.duration || 0),
          codec: metadata.format.codec,
          sampleRate: metadata.format.sampleRate,
          bitrate: metadata.format.bitrate,
          format: metadata.format.container,
          channels: metadata.format.numberOfChannels,
          tags: metadata.common
        };
      } catch (error) {
        console.error('Error analyzing audio file:', error);
        throw new Error(`Failed to analyze audio file: ${error.message}`);
      }
    }

    async validateAudio(filePath) {
      try {
        // Check file size first
        const stats = await fs.promises.stat(filePath);
        if (stats.size > MAX_FILE_SIZE) {
          return {
            isValid: false,
            error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
          };
        }
    
        // Get and validate file type
        const fileType = this.getFileType(filePath);
        if (fileType === 'other') {
          return {
            isValid: false,
            error: `Unsupported audio format. Allowed formats: ${VALID_SOUND_TYPES.join(', ')}`
          };
        }
    
        // Analyze file metadata
        const metadata = await this.analyzeFile(filePath);
        
        // Check duration
        if (metadata.duration > MAX_DURATION) {
          return {
            isValid: false,
            error: `Audio duration exceeds maximum allowed length of ${MAX_DURATION / 60} minutes`
          };
        }
    
        // Additional validation for audio integrity
        if (!metadata.sampleRate || !metadata.channels) {
          return {
            isValid: false,
            error: 'Invalid audio file structure'
          };
        }
    
        return {
          isValid: true,
          metadata: this.normalizeMetadata(metadata, filePath)
        };
      } catch (error) {
        return {
          isValid: false,
          error: `Failed to validate audio file: ${error.message}`
        };
      }
    }

    getFileType(filePath) {
      const extension = path.extname(filePath).toLowerCase().substring(1);
      
      // Direct extension mapping
      if (VALID_SOUND_TYPES.includes(extension)) {
        return extension;
      }

      // Use MIME type as fallback
      const mimeType = mime.getType(filePath);
      const format = mimeType?.split('/')[1];

      if (format) {
        // Convert mpeg to mp3 to match our standardized format
        const normalizedFormat = format === 'mpeg' ? 'mp3' : format;
        
        // Check if the normalized format is in our valid types
        if (VALID_SOUND_TYPES.includes(normalizedFormat)) {
          return normalizedFormat;
        }
      }
      return 'other';  }

    normalizeMetadata(metadata, filePath) {
      const soundType = this.getFileType(filePath);

      return {
        duration: metadata.duration,
        format: soundType,
        sampleRate: metadata.sampleRate,
        bitrate: metadata.bitrate,
        channels: metadata.channels,
        title: metadata.tags?.title,
        artist: metadata.tags?.artist,
        album: metadata.tags?.album,
        year: metadata.tags?.year
      };
    }
  }

  export const audioService = new AudioService();
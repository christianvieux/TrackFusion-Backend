// middlewares/fileUploadConfig.js
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  image: {
    maxFileSize: (parseInt(process.env.IMAGE_MAX_FILE_SIZE)) * 1024 * 1024,
    allowedTypes: process.env.ALLOWED_IMAGE_TYPES.split(','), // ['image/jpeg', 'image/png', 'image/jpg']
    maxWidth: 2000,
    maxHeight: 2000,
    quality: 80
  },
  audio: {
    maxFileSize: (parseInt(process.env.AUDIO_MAX_FILE_SIZE)) * 1024 * 1024,
    maxLength: parseInt(process.env.AUDIO_MAX_LENGTH),
    allowedTypes: process.env.ALLOWED_AUDIO_TYPES.split(','), // ['audio/mpeg', 'audio/wav', 'audio/ogg']
  }
};
// middlewares/audioUploadMiddleware.js
import multer from "multer";
import os from "os";
import * as mm from 'music-metadata';
import { promises as fs } from 'fs';

const audioUploadConfig = {
  maxFileSize: ((parseInt(process.env.AUDIO_MAX_FILE_SIZE) || 300 )* 1024 * 1024),
  maxAudioLength: parseInt(process.env.AUDIO_MAX_LENGTH) || 300, // Default 5 minutes in seconds
  allowedTypes: process.env.ALLOWED_AUDIO_TYPES.split(',')
};

// Helper function to check audio duration
const checkAudioDuration = async (filePath) => {
  try {
    const metadata = await mm.parseFile(filePath);
    const duration = metadata.format.duration;
    return duration <= audioUploadConfig.maxAudioLength;
  } catch (err) {
    console.error('Error checking audio duration:', err);
    return false;
  }
};

const uploadAudio = multer({
  dest: os.tmpdir(),
  fileFilter: (req, file, cb) => {
    if (audioUploadConfig.allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid audio file type. Supported formats: ${audioUploadConfig.allowedTypes.join(', ')}`));
    }
  },
  limits: {
    fileSize: audioUploadConfig.maxFileSize,
  }
});

// Middleware to check audio duration after upload
export const checkAudioFileDuration = async (req, res, next) => {
  const files = req.files || (req.file ? [req.file] : []);
  
  for (const file of files) {
    const isValidDuration = await checkAudioDuration(file.path);
    
    if (!isValidDuration) {
      // Clean up all uploaded files
      await Promise.all(files.map(f => fs.unlink(f.path).catch(console.error)));
      
      return res.status(400).json({
        error: `Audio length exceeds the maximum allowed duration of ${audioUploadConfig.maxAudioLength} seconds.`
      });
    }
  }
  
  next();
};

// Single audio file upload
export const uploadAudioSingle = uploadAudio.single('trackFile');

// Multiple audio files upload - configurable field name and count
export const uploadAudioMultiple = (fieldName, maxCount = 5) => {
  return uploadAudio.array(fieldName, maxCount);
};

// Flexible fields upload for mixed audio uploads
export const uploadAudioFields = (fields) => {
  return uploadAudio.fields(fields);
};

export const handleAudioUploadErrors = (err, req, res, next) => {
  console.log('Request form fields:', req.body);
  console.log('Request files:', req.files);
  console.log('Request file:', req.file);
  
  if (err instanceof multer.MulterError) {
    console.log('Multer error:', {
      code: err.code,
      field: err.field,
      message: err.message
    });
    
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: `Audio file exceeds the ${audioUploadConfig.maxFileSize / (1024 * 1024)}MB limit. Please upload a smaller file.`
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected audio upload field. Please check the field name and try again.'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: 'Too many files uploaded.'
      });
    }
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};
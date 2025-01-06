// middlewares/uploadMiddleware.js
import multer from "multer";
import os from "os";
import sharp from "sharp";
import * as mm from "music-metadata";
import { promises as fs } from "fs";
import { config } from "../middlewares/fileUploadConfig.js";

class FileUploadHandler {
  constructor() {
    const storage = multer.diskStorage({
      destination: os.tmpdir(),
      filename: (req, file, cb) => {
        cb(null, file.originalname);
      }
    });

    const multerOptions = {
      storage,
      fileFilter: this.fileFilter.bind(this),
    };

    this.imageUpload = multer(multerOptions);
    this.audioUpload = multer(multerOptions);
  }

  // Add size check after file type validation
  fileFilter(req, file, cb) {
    // Initialize rejected files array if it doesn't exist
    req.rejectedFiles = req.rejectedFiles || [];

    const fileDetails = {
      fieldName: file.fieldname,
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size ? `${(file.size / (1024 * 1024)).toFixed(2)}MB` : 'Unknown'
    };

    const validations = {
      trackFile: {
        type: 'audio',
        isValid: config.audio.allowedTypes.includes(file.mimetype.toLowerCase()),
        maxSize: config.audio.maxFileSize,
        allowedTypes: config.audio.allowedTypes
      },
      imageFile: {
        type: 'image',
        isValid: config.image.allowedTypes.includes(file.mimetype.toLowerCase()),
        maxSize: config.image.maxFileSize,
        allowedTypes: config.image.allowedTypes
      }
    };

    const fileType = file.fieldname.startsWith('image') ? 'imageFile' : file.fieldname;
    const validation = validations[fileType];

    if (!validation) {
      req.rejectedFiles.push(fileDetails);
      return cb(new Error('Invalid field name'));
    }

    // Type validation
    if (!validation.isValid) {
      req.rejectedFiles.push(fileDetails);
      return cb(new Error(
        `Invalid ${validation.type} file type (${file.mimetype}). Supported formats: ${validation.allowedTypes.join(", ")}`
      ));
    }

    // Size validation
    if (file.size > validation.maxSize) {
      req.rejectedFiles.push(fileDetails);
      return cb(new Error(
        `File too large. Maximum allowed size is ${validation.maxSize / (1024 * 1024)} MB`
      ));
    }

    cb(null, true);
  }

  async processImage(file) {
    if (!file) return null;

    const image = sharp(file.path);
    const metadata = await image.metadata();

    if (
      metadata.width > config.image.maxWidth ||
      metadata.height > config.image.maxHeight
    ) {
      await image
        .resize(config.image.maxWidth, config.image.maxHeight, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: config.image.quality })
        .toFile(`${file.path}_processed`);

      await fs.unlink(file.path);
      await fs.rename(`${file.path}_processed`, file.path);
    }

    return file;
  }

  async checkAudioDuration(file) {
    if (!file) return { isValid: true };

    try {
      const metadata = await mm.parseFile(file.path);
      const duration = metadata.format.duration;
      return {
        isValid: duration <= config.audio.maxLength,
        duration: duration,
      };
    } catch (err) {
      console.error("Error checking audio duration:", err);
      return {
        isValid: false,
        error: "Unable to process audio file",
      };
    }
  }

  handleErrors(err, req, res, next) {
    const errorDetails = {
      type: err instanceof multer.MulterError ? "MulterError" : "GeneralError",
      code: err instanceof multer.MulterError ? err.code : "UNKNOWN",
      message: err.message,
      timestamp: new Date().toISOString(),
    };

    console.warn("Upload warning:", {
      ...errorDetails,
      attemptedUpload: req.files
        ? Object.entries(req.files).flatMap(([field, files]) =>
            files.map(file => ({
              fieldName: field,
              fileName: file.originalname,
              mimeType: file.mimetype,
              size: `${(file.size / (1024 * 1024)).toFixed(2)}MB`
            }))
          )
        : req.file
        ? [{
            fieldName: req.file.fieldname,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: `${(req.file.size / (1024 * 1024)).toFixed(2)}MB`
          }]
        : 'No files submitted',
      rejectedFiles: req.rejectedFiles,
      body: Object.keys(req.body || {}),
      // stack: err.stack,
    });

    // Handle file type validation errors
    if (err.message?.includes("Invalid audio file type")) {
      return res.status(400).json({
        error: err.message,
      });
    }

    if (err.message?.includes("Invalid image file type")) {
      return res.status(400).json({
        error: err.message,
      });
    }

    if (err instanceof multer.MulterError) {
      // For file size errors, determine the type of upload from the request
      let maxSize = config.image.maxFileSize;
      if (req.route && req.route.path && req.route.path.includes("track")) {
        maxSize = config.audio.maxFileSize;
      }

      const messages = {
        LIMIT_FILE_SIZE: `File too large. Maximum allowed size is ${
          maxSize / (1024 * 1024)
        } MB`,
        LIMIT_UNEXPECTED_FILE:
          "Invalid upload request. Please check the upload requirements and try again.",
        LIMIT_FILE_COUNT:
          "Too many files uploaded. Please reduce the number of files and try again.",
        default: "File upload failed. Please try again.",
      };

      return res
        .status(400)
        .json({ error: messages[err.code] || messages.default });
    }

    if (err?.message?.includes("Invalid file format")) {
      return res.status(400).json({
        error: "Invalid file format. Please upload a JPEG or PNG image.",
      });
    }

    // Generic error for unexpected cases
    return res.status(400).json({
      error: "Upload failed. Please check file requirements and try again.",
    });
  }
}

const uploadHandler = new FileUploadHandler();

// Middleware for handling track uploads (audio + optional image)
export const uploadTrackFiles = uploadHandler.audioUpload.fields([
  { name: "trackFile", maxCount: 1 },
  { name: "imageFile", maxCount: 1 },
]);

export const processUploadedFiles = async (req, res, next) => {
  try {
    // Process image if present
    if (req.files?.imageFile) {
      await Promise.all(
        req.files.imageFile.map((file) => uploadHandler.processImage(file))
      );
    }

    // Check audio duration if present
    if (req.files?.trackFile) {
      const durationCheck = await uploadHandler.checkAudioDuration(
        req.files.trackFile[0]
      );
      if (!durationCheck.isValid) {
        const filesToClean = [
          ...(req.files.trackFile || []).map((f) => f.path),
          ...(req.files.imageFile || []).map((f) => f.path),
        ];

        await Promise.all(
          filesToClean.map((path) => fs.unlink(path).catch(console.error))
        );

        return res.status(400).json({
          error:
            durationCheck.error ||
            `The audio file exceeds the maximum allowed duration of ${
              config.audio.maxLength / 60
            } minutes.`,
        });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Single image upload with processing
export const uploadImageSingle = [
  uploadHandler.imageUpload.single("imageFile"),
  async (req, res, next) => {
    try {
      if (req.file) {
        await uploadHandler.processImage(req.file);
      }
      next();
    } catch (error) {
      next(error);
    }
  },
];

// Multiple images upload with processing
export const uploadImageMultiple = (fieldName, maxCount = 5) => [
  uploadHandler.upload.array(fieldName, maxCount),
  async (req, res, next) => {
    try {
      if (req.files) {
        await Promise.all(
          req.files.map((file) => uploadHandler.processImage(file))
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  },
];

export const handleUploadErrors =
  uploadHandler.handleErrors.bind(uploadHandler);

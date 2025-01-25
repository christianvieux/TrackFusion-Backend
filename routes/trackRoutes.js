// routes/trackRoutes.js
import dotenv from 'dotenv'; dotenv.config();  // Load environment variables from .env file
import express from "express";
import mime from 'mime';
import Joi from 'joi';
import fs from 'fs/promises'
import multer from "multer";
import os from "os";
import path from "path";
import {
  uploadTrackToDatabase,
  getTrack,
  updateTrack,
  deleteTrack,
  getPublicTracks,
  getUserFavoriteTracks,
  favoriteTrack,
  unfavoriteTrack,
  getUserTracks,
} from "../controllers/trackController.js";
import { authorizeTrackUrl } from "../controllers/trackController.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { uploadTrackFileToBlob, uploadTrackImageFileToBlob, getBlobPathnameFromUrl, deleteBlob } from "../utils/azureBlob.js";
import * as musicMetadata from 'music-metadata';
// Cleanup function to delete files
import { cleanupFiles } from "../utils/cleanup.js";
import {uploadTrackFiles, processUploadedFiles, handleUploadErrors } from '../middlewares/uploadMiddleware.js';

const DEBUG = true;

const upload_trackSchema = Joi.object({
  name: Joi.string().required(),
  artist: Joi.string().allow(""),
  description: Joi.string().allow(""),
  is_private: Joi.boolean().required(),
  category: Joi.string().required(),
  genre: Joi.string().required(),
  mood: Joi.string().required(),
  bpm: Joi.number().integer().min(0).allow(null),
});

const upload = multer({ dest: os.tmpdir() });

const router = express.Router();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_ENABLED = false;
const DELAY_TIME = parseInt(process.env.DELAY_TIME) || 10000; // Default delay time is 1000ms

const getMappedSoundType = (mimetype) => {
  // First check if it's a valid audio type
  const allowedTypes = process.env.ALLOWED_AUDIO_TYPES.split(',');
  if (!allowedTypes.includes(mimetype)) {
    console.warn(`Invalid audio type '${mimetype}', not found in allowed types: ${mimetype}`);
    return null;
  }

  // Extract extension from mimetype (everything after '/')
  const extension = mimetype.split('/').pop();
  
  // Handle special cases
  switch(extension) {
    case 'mpeg':
      return 'mp3';
    case 'x-wav':
      return 'wav';
    case 'x-m4a':
      return 'm4a';
    default:
      return extension;
  }
};

const debugLog = (category, message, data = {}) => {
  if (!DEBUG) return;
  console.log(`[${new Date().toISOString()}] [${category}] ${message}`, data);
};

// Route to create a new track
router.post(
  "/create",
  (req, res, next) => {
    console.log('Headers:', req.headers);
    console.log('Content-Length:', req.headers['content-length']);
    console.log('Request received at /create endpoint');
    next();
  },
  authenticateToken,
  uploadTrackFiles,
  processUploadedFiles,
  handleUploadErrors,
  async (req, res) => {
    try {
      debugLog('FILES', 'Received upload request', {
        trackFile: req.files?.trackFile?.[0]?.originalname,
        imageFile: req.files?.imageFile?.[0]?.originalname,
        bodyFields: Object.keys(req.body)
      });
      // Validate required files
      if (!req.files?.trackFile || req.files.trackFile.length === 0) {
        debugLog('VALIDATION', 'Missing track file');
        return res.status(400).json({ error: "Audio track file is required" });
      }
      
      const { error, value } = upload_trackSchema.validate(req.body);
      if (error) {
        debugLog('VALIDATION', 'Schema validation failed', { error: error.details[0].message });
        return res.status(400).json({ error: error.details[0].message });
      }

      debugLog('METADATA', 'Extracting audio metadata');
      const trackFile = req.files?.trackFile?.[0]; // Accessing the first file in the array
      const trackFilePath = trackFile.path;
      const imageFile = req.files?.imageFile?.[0]; // Optional image file
      const userId = req.session.user.id;
      
      let duration = 0;
      try {
        const metadata = await musicMetadata.parseFile(trackFilePath);
        duration = metadata.format.duration; // in seconds
        debugLog('METADATA', 'Audio metadata extracted', { duration, format: metadata.format });
      } catch (error) {
        debugLog('ERROR', 'Failed to extract audio metadata', { error });
      }


      const sanitizedData = {
        name: value.name.trim(),
        artist: value.artist ? value.artist.trim() : '',
        description: value.description ? value.description.trim() : '',
        is_private: value.is_private,
        category: value.category.trim(),
        genre: value.genre.trim(),
        mood: value.mood.trim(),
        bpm: value.bpm,
        image_url: null,
        creator_id: userId,
        sound_type: getMappedSoundType(trackFile.mimetype),
        length: duration,
      };

      debugLog('DB', 'Creating track record', sanitizedData);
      // Create the track in the database without the file URL
      const newTrack = await uploadTrackToDatabase(sanitizedData);
      debugLog('DB', 'Track record created', { trackId: newTrack.id });

      try {
        // Upload image if exists
        if (imageFile) {
          debugLog('UPLOAD', 'Uploading image file', { 
            filename: imageFile.originalname,
            size: `${(imageFile.size / (1024 * 1024)).toFixed(2)}MB` 
          });
          const imageUrl = await uploadTrackImageFileToBlob(imageFile, newTrack.id);
          await updateTrack(newTrack.id, { image_url: imageUrl });
        }
        // Upload track file
        const metaData = {
          category: "tracks",
          title: sanitizedData.name,
          userId: userId.toString(),
          trackId: newTrack.id.toString(),
        };

        debugLog('UPLOAD', 'Uploading track file', {
          filename: trackFile.originalname,
          size: `${(trackFile.size / (1024 * 1024)).toFixed(2)}MB`
        });
        const fileUrl = await uploadTrackFileToBlob(
          trackFile,
          userId,
          newTrack.id,
          metaData
        );

        // Update the track in the database with the file URL
        const updatedTrack = await updateTrack(newTrack.id, { url: fileUrl });
        debugLog('SUCCESS', 'Track upload completed', { trackId: updatedTrack.id });

        res.status(201).json(updatedTrack);
      } catch (uploadError) {
        debugLog('ERROR', 'Upload failed, cleaning up', { error: uploadError.message });
        // If file upload fails, delete the track from database
        await deleteTrack(newTrack.id);
        throw uploadError;
      }
    } catch (error) {
        debugLog('ERROR', 'Track creation failed', { error: error.message });
        res.status(500).json({ error: "Internal server error" });
    } finally {
      debugLog('CLEANUP', 'Cleaning up temporary files');
      // Single cleanup point for all files
      if (req.files) {
        await cleanupFiles(req.files);
      }
    }
  }
);

// Route to get authorized URL for a track
router.get("/:id/authorized-url", async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user?.id;
  console.log(
    `Fetching authorized URL for track ID: ${id} by user ID: ${userId}`
  );
  if (DELAY_ENABLED) await delay(DELAY_TIME);

  try {
    const track = await getTrack(id);
    console.log(`Track fetched: ${JSON.stringify(track)}`, track.is_private);

    if (!track || (track.is_private && track.creator_id !== userId)) {
      console.warn(
        `Unauthorized access attempt by user ID: ${userId} for track ID: ${id}`
      );
      return res
        .status(403)
        .json({ error: "Track does not exist or Unauthorized" });
    }

    const randomId = Math.random().toString(36).substring(7);
    const authorizedUrl = await authorizeTrackUrl(track.url);
    console.log(`Authorized URL generated: ${authorizedUrl}, randomId: ${randomId}`);
    res.json({ url: authorizedUrl, randomId });
  } catch (error) {
    console.error("Error fetching authorized URL for track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to get a user's created tracks
router.get("/user", authenticateToken, async (req, res) => {
  if (!req.session.user || !req.session.user.id) {
    return res.status(400).json({ error: "User not authenticated" });
  }
  const userId = req.session.user.id;
  try {
    const userTracks = await getUserTracks(userId);
    res.json(userTracks);
  } catch (error) {
    console.error("Error fetching user tracks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to get public tracks
router.get("/public", async (req, res) => {
  try {
    const publicTracks = await getPublicTracks();
    res.json(publicTracks);
  } catch (error) {
    console.error("Error fetching public tracks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to get user's favorite tracks
router.get("/favorites", authenticateToken, async (req, res) => {
  if (!req.session.user || !req.session.user.id) {
    return res.status(400).json({ error: "User not authenticated" });
  }
  const userId = req.session.user.id;
  try {
    const favoriteTracks = await getUserFavoriteTracks(userId);
    res.json(favoriteTracks);
  } catch (error) {
    console.error("Error fetching user favorite tracks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to remove a favorite track
router.delete("/favorites", authenticateToken, async (req, res) => {
  const userId = req.session.user.id;
  const { trackId } = req.body;
  try {
    const favorite = await unfavoriteTrack(userId, trackId);
    // Broadcast update via WebSocket
    // broadcastToUser(userId, {
    //   event: "FAVORITE_TRACK",
    //   action: "REMOVE",
    //   data: { track: favorite },
    // });
    console.log(
      `User ${userId} removed favorite track removed: ${JSON.stringify(
        favorite
      )}`
    );
    res.json(favorite);
  } catch (error) {
    console.error("Error removing favorite track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to favorite a track
router.post("/favorites", authenticateToken, async (req, res) => {
  const userId = req.session.user.id;
  const { trackId } = req.body;
  try {
    const favorite = await favoriteTrack(userId, trackId);
    // Broadcast update via WebSocket
    // broadcastToUser(userId, {
    //   "event": "FAVORITE_TRACK",
    //   "action": "ADD",
    //   data: { track: favorite },
    // });
    res.json(favorite);
  } catch (error) {
    console.error("Error adding favorite track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


////////////////////Make sure these stay at the very bottom/////////////////////////////////////

// router.get('/:id', getTrack);
router.get("/:id", async (req, res) => {
  const trackSchema = Joi.object({
    id: Joi.number().integer().required(),
  });

  const { id } = req.params;

  try {
    const { error, value } = trackSchema.validate({ id });
    if (error) {
      return res.status(400).send({ error: error.details[0].message });
    }

    const track = await getTrack(value.id);
    if (!track) {
      return res.status(404).json({ error: "Track not found or access denied" });
    }

    res.json(track);
  } catch (err) {
    console.error("Error fetching track:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const trackId = req.params.id;
  const userId = req.session.user?.id;
  const { name, description, is_private } = req.body;

  // Validate input
  const errors = [];
  if (!name) {
    errors.push("Name is required");
  }
  if (!description) {
    errors.push("Description is required");
  }
  if (typeof is_private === "undefined") {
    errors.push("Privacy status (is_private) is required");
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(", ") });
  }

  try {
    // Fetch the track to ensure it exists and belongs to the user
    const track = await getTrack(trackId);
    if (!track || track.creator_id !== userId) {
      return res
        .status(404)
        .json({ error: "Track not found or access denied" });
    }

    // Update the track
    const updatedTrack = await updateTrack(trackId, {
      name,
      description,
      is_private,
    });
    res.json(updatedTrack);
    console.log(
      `User ${userId} updated track: ${trackId} with data: ${JSON.stringify(
        req.body
      )}`
    );
  } catch (error) {
    console.error("Error updating track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {

  console.log(req.cookies, req.session)
  const trackId = req.params.id;
  const userId = req.user.id;  // Change this line to use req.user

  try {
    const deletedTrack = await deleteTrack(trackId);

    if (deletedTrack) {
      console.log(`User ${userId} deleted track: ${deletedTrack}`);
    } else {
      return res
        .status(404)
        .json({ error: "Track not found or access denied" });
    }

    console.log(`User ${userId} deleted track: ${trackId}`);
    res.json({ message: "Track deleted successfully" });
  } catch (error) {
    console.error("Error deleting track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to delete a user's created track
// router.delete('/user/:userId/:trackId', async (req, res) => {
//   const { userId, trackId } = req.params;
//   try {
//       const deletedTrack = await deleteUserTrack(userId, trackId);
//       if (deletedTrack) {
//           res.json({ message: 'Track deleted successfully' });
//       } else {
//           res.status(404).json({ error: 'Track not found or not created by this user' });
//       }
//   } catch (error) {
//       console.error('Error deleting user track:', error);
//       res.status(500).json({ error: 'Internal server error' });
//   }
// });

export default router;

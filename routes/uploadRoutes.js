// uploadRoutes.js

import express from "express";
import Joi from "joi";
import {
  trackUploadQueue,
  profilePictureUploadQueue,
} from "../queue/uploadQueue.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";

const router = express.Router();

const uploadTrackSchema = Joi.object({
  trackUrl: Joi.object({
    key: Joi.string().required(),
    uploadUrl: Joi.string().required(),
    publicUrl: Joi.string().required(),
  }).required(),
  imageUrl: Joi.object({
    key: Joi.string().required(),
    uploadUrl: Joi.string().required(),
    publicUrl: Joi.string().required(),
  }).optional(),
  name: Joi.string().required().min(1).max(100),
  artist: Joi.string().allow(null, "").optional(), // Allow null or empty string
  description: Joi.string().allow("").optional().max(500),
  is_private: Joi.boolean().default(false),
  category: Joi.string().optional(),
  genre: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()))
    .optional(),
  mood: Joi.alternatives()
    .try(Joi.string(), Joi.array().items(Joi.string()))
    .optional(),
  bpm: Joi.number().integer().min(0).max(300).allow(null).optional(),
});

const uploadProfilePictureSchema = Joi.object({
  imageUrl: Joi.object({
    key: Joi.string().required(),
    uploadUrl: Joi.string().required(),
    publicUrl: Joi.string().required(),
  }).required(),
});

// upload track
router.post("/track", authenticateToken, async (req, res) => {
  try {
    // Validate with track schema
    const { error, value } = uploadTrackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.session.user.id;
    const {
      trackUrl,
      imageUrl,
      name,
      artist,
      description,
      is_private,
      category,
      genre,
      mood,
      bpm,
    } = req.body;
    const jobId = (
      await trackUploadQueue.add("track", {
        userId,
        trackUrl,
        imageUrl,
        name,
        artist,
        description,
        is_private,
        category,
        genre,
        mood,
        bpm,
      })
    ).id;
    // send jobId to client, job started
    res.status(202).json({ jobId });
  } catch (error) {
    console.error("Error uploading track:", error);
    res.status(500).json({ error: "Failed to upload track" });
  }
});

// check status for uploaded file being processed
router.get("/track-status/:jobId", authenticateToken, async (req, res) => {
  try {
    const job = await trackUploadQueue.getJob(req.params.jobId);
    const state = await job.getState();

    const response = {
      id: job.id,
      state,
      progress: job._progress,
      result: job.returnvalue,
      error: job.failedReason,
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// upload profile-picture
router.post("/profile-picture", authenticateToken, async (req, res) => {
  try {
    // Validate with profile picture schema
    const { error, value } = uploadProfilePictureSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.session.user.id;
    const { imageUrl } = req.body;
    const jobId = (
      await profilePictureUploadQueue.add("profile-picture", {
        userId,
        imageUrl,
      })
    ).id;
    // send jobId to client, job started
    res.status(202).json({ jobId });
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    res.status(500).json({ error: "Failed to upload profile picture" });
  }
});

// check status for profile-picture being processed
router.get(
  "/profile-picture-status/:jobId",
  authenticateToken,
  async (req, res) => {
    try {
      const job = await profilePictureUploadQueue.getJob(req.params.jobId);
      const state = await job.getState();

      const response = {
        id: job.id,
        state,
        progress: job._progress,
        result: job.returnvalue,
        error: job.failedReason,
      };

      res.json(response);
    } catch (error) {
      res.status(500).json({ error: "Failed to get status" });
    }
  }
);

export default router;

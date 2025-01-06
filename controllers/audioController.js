// src/controllers/audioController.js
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import multer from "multer";
import Joi from "joi";
import { spawn } from "child_process";
import { convertAudioService } from "../services/audioServices.js";
import dotenv from 'dotenv'; dotenv.config();  // Load environment variables from .env file
import { audioQueue } from '../services/audioQueueService.js';


const upload = multer({ dest: os.tmpdir() });
const allowedImageTypes = process.env.ALLOWED_IMAGE_TYPES.split(',');


// Method to convert a URL to an audio file
export const convertUrlToAudio = async (req, res) => {
  // Define a schema for validation
  const urlToAudioSchema = Joi.object({
    url: Joi.string().uri().required(),  // URL must be a valid URI and is required
    format: Joi.string().valid("mp3", "wav", "m4a", "aac").default("mp3"),  // Only common/popular formats
  });
  const { error, value } = urlToAudioSchema.validate(req.body);
  if (error) return res.status(400).send({ error: error.details[0].message });

  try {
    await convertAudioService(value, res); // Stream via service

  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
};

// Method to analyze the BPM and key of an audio file
export const analyzeAudio = async (req, res) => {
  const analyzeAudioSchema = Joi.object({
    file: Joi.object().required(),
    bpmRange: Joi.string().valid("50-100", "75-150", "100-200").required(),
  });
  const { file } = req;
  const { bpmRange } = req.body;
  const { error } = analyzeAudioSchema.validate({ file, bpmRange });

  if (error) {
    console.log("It was me fam!9999999997777777777777777")
    return res.status(400).send({ error: error.details[0].message });
  }

  try {
    const job = await audioQueue.add({
      filePath: req.file.path,
      bpmRange: req.body.bpmRange
    });

    res.status(202).json({
      jobId: job.id,
      message: 'Analysis started'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to queue analysis'
    });
  }
};

export const getAnalysisStatus = async (req, res) => {
  try {
    const job = await audioQueue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const state = await job.getState();
    const progress = job._progress;

    if (state === 'completed') {
      const result = await job.finished();
      return res.json({ state, progress: 100, result });
    }

    if (state === 'failed') {
      return res.status(400).json({
        state,
        error: job.failedReason
      });
    }

    res.json({ state, progress });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching job status' });
  }
};

// Middleware to handle file uploads
export const uploadFile = upload.single("track");

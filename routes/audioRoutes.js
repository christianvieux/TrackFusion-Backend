import express from "express";
import Joi from "joi";
import path from "path";
import { audioAnalysisQueue, audioQueue } from '../queue/audioQueue.js';
import { authenticateToken } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.use(authenticateToken);

const analyzeAudioSchema = Joi.object({
  trackUrl: Joi.object({
    key: Joi.string().required(),
    uploadUrl: Joi.string().uri().optional(),
    publicUrl: Joi.string().uri().optional(),
  }).required(),
  bpmRange: Joi.string().valid("50-100", "75-150", "100-200").default("50-100"),
});

function userOwnsJob(job, userId) {
  return job && String(job.data.userId) === String(userId);
}


router.get("/status/:jobId", async (req, res) => {
  const job = await audioQueue.getJob(req.params.jobId);

  if (!userOwnsJob(job, req.user.id)) {
    return res.status(404).send({ error: "Job not found" });
  }

  const state = await job.getState();
  const progress = job.progress();
  const failedReason = job.failedReason;

  if (state === 'failed') {
    return res.status(400).send({ 
      state, 
      progress, 
      error: failedReason || 'Unknown error'
    });
  }

  if (state === 'completed') {
    const result = await job.finished();
    return res.send({ state, progress, result });
  }

  res.send({ state, progress });
});
router.get("/result/:jobId", async (req, res) => {
  const job = await audioQueue.getJob(req.params.jobId);

  if (!userOwnsJob(job, req.user.id)) {
    return res.status(404).send({ error: "Job not found" });
  }

  if (job.returnvalue) {
    res.send(job.returnvalue);
  } else {
    res.status(404).send({ error: "Result not found" });
  }
});
router.get('/download/:jobId', async (req, res) => {
  const job = await audioQueue.getJob(req.params.jobId);

  if (!userOwnsJob(job, req.user.id)) {
    return res.status(404).send({ error: 'Job not found' });
  }

  if (job.returnvalue && job.returnvalue.file_path) {
    const filePath = job.returnvalue.file_path;
    res.download(filePath, path.basename(filePath), (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        res.status(500).send({ error: 'Failed to download file' });
      }
    });
  } else {
    res.status(404).send({ error: 'File not found' });
  }
});

// Route to analyze audio
router.post("/analyze", async (req, res) => {
  try {
    const { error, value } = analyzeAudioSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { trackUrl, bpmRange } = value;
    if (!trackUrl.key.startsWith(`uploads/${req.user.id}/`)) {
      return res.status(403).json({ error: "Upload key does not belong to this user" });
    }

    // Add to analysis queue
    const job = await audioAnalysisQueue.add({
      userId: req.user.id,
      trackUrl,
      bpmRange,
    });

    res.status(202).json({ 
      jobId: job.id,
      message: 'Analysis started' 
    });
  } catch (error) {
    console.error("Error queueing analysis:", error);
    res.status(500).json({ error: "Failed to start analysis" });
  }
});

router.get("/analysis-status/:jobId", async (req, res) => {
  try {
    const job = await audioAnalysisQueue.getJob(req.params.jobId);
    if (!userOwnsJob(job, req.user.id)) {
      return res.status(404).json({ error: "Analysis job not found" });
    }
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

export default router;

import express from "express";
import Queue from "bull";
import path from "path";
import { audioAnalysisQueue } from '../queue/audioQueue.js';

const router = express.Router();
const audioQueue = new Queue("audio conversion", "redis://127.0.0.1:6379");



router.get("/status/:jobId", async (req, res) => {
  const job = await audioQueue.getJob(req.params.jobId);

  if (!job) {
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

  if (!job) {
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

  if (!job) {
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
  const { trackUrl, bpmRange } = req.body;
  
  try {
    // Add to analysis queue
    const job = await audioAnalysisQueue.add({
      trackUrl,
      bpmRange: bpmRange || "50-100"
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

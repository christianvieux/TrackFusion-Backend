// Backend/services/audioServices.js

import { spawn } from "child_process";
import fs from "fs";
import Queue from "bull";
import dotenv from 'dotenv';
dotenv.config();

export const audioQueue = new Queue('audio conversion', process.env.REDIS_URL);
export const cleanupQueue = new Queue('audio cleanup', process.env.REDIS_URL);

export const convertAudioService = async (data, res) => {
  const { url, format } = data;

  try {
    // Add a job to the queue and wait for it to be added
    const job = await audioQueue.add({ url, format });
    console.log("Job added to queue", job.id); 
    res.status(202).send({ message: 'Audio conversion started', jobId: job.id }); // Send the job ID in the response
  } catch (error) {
    console.error("Error adding job to queue:", error);
    res.status(500).send({ error: 'Failed to start audio conversion' });
  }
};

export const cleanupJob = async (job, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (job) {
      await job.remove();
      console.log(`Job ${job.id} cleaned up successfully.`);
    }
  } catch (error) {
    console.error(`Error cleaning up job ${job?.id}:`, error);
  }
};

const ERROR_TYPES = {
  VIDEO_UNAVAILABLE: 'VIDEO_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONVERSION_ERROR: 'CONVERSION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

const MAX_RETRIES = 1;

const processAudioJob = async (job, retryCount = 0, useProxy = true) => {
  let pythonProcess = null;
  
  try {
    // Set initial progress
    await job.progress(0);
    
    const { url, format } = job.data;
    const env = { ...process.env };
    
    if (!useProxy) {
      delete env.YT_DLP_PROXY_URL;
    }

    return new Promise((resolve, reject) => {
      pythonProcess = spawn('python3', ['python/scripts/url_to_audio.py', url, format], { env });
      
      let errorOutput = '';
      let progressOutput = '';
      let lastProgress = 0;

      pythonProcess.stdout.on('data', (data) => {
        const dataStr = data.toString();
        progressOutput += dataStr;
        console.log("Python output:", dataStr);

        const progressMatch = dataStr.match(/(\d+\.?\d*)%/);
        if (progressMatch) {
          const currentProgress = Math.min(parseFloat(progressMatch[1]), 99);
          if (currentProgress > lastProgress) {
            lastProgress = currentProgress;
            job.progress(currentProgress).catch(console.error);
          }
        }
      });

      pythonProcess.stderr.on('data', (data) => {
        const dataStr = data.toString();
        errorOutput += dataStr;
        console.log("Python error:", dataStr);
        
        if (dataStr.includes('ERROR:')) {
          pythonProcess.kill();
        }
      });

      pythonProcess.on('exit', async (code) => {
        if (code !== 0) {
          const error = parseError(errorOutput);
          
          // Handle retry logic
          if (error.type === ERROR_TYPES.NETWORK_ERROR && retryCount < MAX_RETRIES) {
            console.log(`Retrying job ${job.id} without proxy...`);
            resolve(processAudioJob(job, retryCount + 1, false));
            return;
          }

          // Mark job as failed with detailed error message
          await job.moveToFailed({ 
            message: error.message,
            errorType: error.type,
            failedAt: new Date()
          });
          
          reject(error);
          return;
        }

        // Success case
        const resultMatch = progressOutput.match(/RESULT_FILE:(.+)$/m);
        if (resultMatch) {
          const resultFile = resultMatch[1].trim();
          await job.progress(100);

          // Read file content into memory before scheduling cleanup
          const fileContent = fs.readFileSync(resultFile);
          const result = JSON.parse(fileContent);

          // Schedule cleanup after 5 minutes
          cleanupQueue.add({ filePath: result.file_path }, { 
            delay: 900000 // 15 minutes instead of 5
          });

          resolve({
            success: true,
            file_content: fileContent,
            ...result
          });
        } else {
          reject(createError(ERROR_TYPES.UNKNOWN_ERROR, 'Result file not found'));
        }
      });

      // Handle process errors
      pythonProcess.on('error', async (error) => {
        const formattedError = createError(ERROR_TYPES.UNKNOWN_ERROR, error.message);
        await job.moveToFailed({
          message: formattedError.message,
          errorType: formattedError.type,
          failedAt: new Date()
        });
        reject(formattedError);
      });
    });

  } catch (error) {
    // Cleanup on error
    if (pythonProcess) {
      pythonProcess.kill();
    }
    
    const formattedError = createError(ERROR_TYPES.UNKNOWN_ERROR, error.message);
    await job.moveToFailed({
      message: formattedError.message,
      errorType: formattedError.type,
      failedAt: new Date()
    });
    throw formattedError;
  }
};

const createError = (type, message) => ({
  type,
  message,
  timestamp: new Date()
});

// Error parsing utility
function parseError(errorOutput) {
  if (errorOutput.includes('Video unavailable')) {
    return createError(ERROR_TYPES.VIDEO_UNAVAILABLE, 'The requested video is unavailable');
  }
  if (errorOutput.includes('Unable to download') || errorOutput.includes('Network Error')) {
    return createError(ERROR_TYPES.NETWORK_ERROR, 'Failed to download due to network issues');
  }
  if (errorOutput.includes('ERROR:')) {
    return createError(ERROR_TYPES.CONVERSION_ERROR, 'Failed to convert audio');
  }
  return createError(ERROR_TYPES.UNKNOWN_ERROR, 'An unexpected error occurred');
}

// Process the job
audioQueue.process(async (job) => {
  try {
    return await processAudioJob(job);
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);
    throw error; // Propagate error to Bull queue
  }
});

// Add error handling for the queue
audioQueue.on('error', (error) => {
  console.error("Queue error:", error);
});

// Process the cleanup job
cleanupQueue.process(async (job) => {
  const { filePath } = job.data;

  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // Delete the file
      console.log(`File ${filePath} deleted successfully.`);
    }
  } catch (error) {
    console.error(`Error deleting file ${filePath}:`, error);
  }
});

// Add error handling for the cleanup queue
cleanupQueue.on('error', (error) => {
  console.error("Cleanup queue error:", error);
});
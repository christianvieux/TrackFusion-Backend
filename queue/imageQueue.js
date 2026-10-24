// imageQueueService.js
import Queue from 'bull';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = util.promisify(exec);

export const imageQueue = new Queue('image-processing', process.env.REDIS_URL);

imageQueue.process(async (job) => {
  const { filePath, userId } = job.data;
  const outputDir = path.join(process.cwd(), 'public/uploads/profile-pictures');
  const outputFileName = `${userId}_${Date.now()}.jpg`;
  const outputPath = path.join(outputDir, outputFileName);

  try {
    // Ensure output directory exists
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Start processing - Validate image
    await job.progress(25);
    const { stdout: validationOutput } = await execAsync(
      `python3 python/scripts/image_validator.py ${filePath}`
    );
    
    const validation = JSON.parse(validationOutput);
    if (!validation.isValid) {
      throw new Error(validation.error || 'Invalid image file');
    }

    // Process image - Resize and optimize
    await job.progress(50);
    const { stdout: processingOutput } = await execAsync(
      `python3 python/scripts/image_processor.py ${filePath} ${outputPath}`
    );
    
    const processing = JSON.parse(processingOutput);
    if (!processing.success) {
      throw new Error(processing.error || 'Failed to process image');
    }

    // Final validation and metadata extraction
    await job.progress(75);
    const { stdout: metadataOutput } = await execAsync(
      `python3 python/scripts/image_metadata.py ${outputPath}`
    );

    const metadata = JSON.parse(metadataOutput);
    
    // Clean up original file
    await fs.promises.unlink(filePath);
    await job.progress(100);
    
    return {
      success: true,
      filePath: `/uploads/profile-pictures/${outputFileName}`,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: metadata.size
      }
    };
  } catch (error) {
    // Clean up files on error
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    if (fs.existsSync(outputPath)) {
      await fs.promises.unlink(outputPath);
    }
    throw error;
  }
});
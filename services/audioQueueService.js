import Queue from 'bull';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';

const execAsync = util.promisify(exec);

export const audioQueue = new Queue('audio-analysis', process.env.REDIS_URL);

audioQueue.process(async (job) => {
  const { filePath, bpmRange } = job.data;
  const [minBpm, maxBpm] = bpmRange.split('-').map(Number);

  try {
    await job.progress(25);
    const { stdout: bpmOutput } = await execAsync(
      `python3 python/scripts/bpm_analyzer.py ${filePath} ${minBpm} ${maxBpm}`
    );

    await job.progress(50);
    const { stdout: keyOutput } = await execAsync(
      `python3 python/scripts/key_analyzer.py ${filePath}`
    );

    await job.progress(75);
    const results = {
      bpm: JSON.parse(bpmOutput).bpm,
      key: JSON.parse(keyOutput).key
    };

    fs.unlinkSync(filePath);
    await job.progress(100);
    
    return results;
  } catch (error) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
});
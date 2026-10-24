// utils/audioTest.js
import fetch from 'node-fetch';
import * as mm from 'music-metadata';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export async function testAudioMetadata(audioUrl) {
  console.log('Starting audio metadata test for URL:', audioUrl);
  const tempFilePath = path.join(os.tmpdir(), `test_audio_${Date.now()}`);
  
  try {
    // Download the file
    console.log('Downloading audio file...');
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    const buffer = await response.buffer();
    await fs.writeFile(tempFilePath, buffer);
    console.log('File downloaded successfully');

    // Analyze the audio
    console.log('Analyzing audio metadata...');
    const metadata = await mm.parseFile(tempFilePath);
    
    const audioInfo = {
      format: {
        duration: Math.floor(metadata.format.duration || 0),
        codec: metadata.format.codec,
        container: metadata.format.container,
        sampleRate: metadata.format.sampleRate,
        bitrate: metadata.format.bitrate,
        numberOfChannels: metadata.format.numberOfChannels,
        lossless: metadata.format.lossless,
      },
      tags: metadata.common
    };

    console.log('\nAudio Metadata Results:');
    console.log(JSON.stringify(audioInfo, null, 2));
    
    return audioInfo;

  } catch (error) {
    console.error('Error analyzing audio:', error);
    throw error;
  } finally {
    // Cleanup
    try {
      await fs.unlink(tempFilePath);
      console.log('Temporary file cleaned up');
    } catch (cleanupError) {
      console.error('Error cleaning up temporary file:', cleanupError);
    }
  }
}

export default testAudioMetadata;

// Example usage in your main file:
// import { testAudioMetadata } from './utils/audioTest.js';

// const TEST_AUDIO_URL = 'https://your-test-audio-url.com/audio.mp3';
// testAudioMetadata("tracks/59/1737965515307-test.mp3")
//   .catch(console.error);
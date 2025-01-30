// services/uploadQueue.js
import Queue from 'bull';
import { audioService } from "../services/audioService.js";
import { imageService } from "../services/imageService.js";
import { s3Service } from "../services/s3Service.js";
import { uploadTrackToDatabase, updateTrackOnDatabase } from "../controllers/trackController.js";
import { updateUserOnDatabase, getUserById } from '../controllers/userController.js';
import { cleanupFiles } from '../utils/cleanup.js';
import fs from 'fs';


const trackUploadQueue = new Queue('file-processing', process.env.REDIS_URL);
const profilePictureUploadQueue = new Queue('profile-picture-processing', process.env.REDIS_URL);


trackUploadQueue.process("track", async (job) => {
  const tempFiles = [];
  const {
    userId,
    trackUrl,
    imageUrl,
    name,
    artist,
    description,
    is_private,
    category,
    genre = [],
    mood = [],
    bpm,
  } = job.data;

  try {
    // Download track file from S3
    job.progress("Downloading track file...");
    console.log(`Downloading file from S3: ${trackUrl.uploadUrl}`);
    const trackDownloadResult = await s3Service.downloadToTemp(trackUrl.key);
    tempFiles.push(trackDownloadResult.filePath);

    // Check if audio is valid
    job.progress("Validating audio...");
    const validation = await audioService.validateAudio(trackDownloadResult.filePath);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Download image file from s3 (if provided)
    job.progress("Downloading artwork...");
    if (imageUrl) {
      let imageDownloadResult = null;
      imageDownloadResult = await s3Service.downloadToTemp(imageUrl.key)
      tempFiles.push(imageDownloadResult?.filePath);

      // Check if image is valid
      job.progress("Validating image...");
      const validation = await imageService.validateImage(imageDownloadResult.filePath);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }
    }

    // Analyze the audio file
    job.progress("Analyzing audio...");
    const metadata = await audioService.analyzeFile(tempFiles[0]);
    const normalizedMetadata = audioService.normalizeMetadata(
      metadata,
      tempFiles[0]
    );

    job.progress("Processing metadata...");

    // Format genre and mood arrays
    const formattedGenre = Array.isArray(genre) ? genre.join(",") : genre;
    const formattedMood = Array.isArray(mood) ? mood.join(",") : mood;

    // Prepare track data according to database schema
    const enrichedTrackData = {
      name,
      artist: artist || null,
      description: description || null,
      is_private: is_private || false,
      category: category || null,
      genre: formattedGenre,
      mood: formattedMood,
      length: normalizedMetadata.duration || 0,
      bpm: bpm || null,
      creator_id: userId,
      sound_type: normalizedMetadata.format || "unknown",
      url: trackUrl.publicUrl,
      image_url: imageUrl?.publicUrl,
    };

    job.progress("Saving to database...");
    // Create database record
    const uploadedTrack = await uploadTrackToDatabase(enrichedTrackData);

    
    // Move the track file to its final location
    job.progress("Finalizing upload...");
    try {
      const finalizedTrack = await s3Service.finalizeTrackUpload(
        trackUrl.key,
        userId,
        uploadedTrack.id
      );
      await updateTrackOnDatabase(uploadedTrack.id, { url: finalizedTrack.url });
    
      if (imageUrl) {
        const finalizedCover = await s3Service.finalizeCoverArtUpload(
          imageUrl.key,
          userId,
          uploadedTrack.id
        );
        await updateTrackOnDatabase(uploadedTrack.id, { image_url: finalizedCover.url });
      }
    } catch (moveError) {
      console.error('Failed to move files to final location:', moveError);
      throw new Error(`File movement failed: ${moveError.message}`);
    }

    job.progress("Upload complete!");

    console.log("Track uploaded successfully:", uploadedTrack);
    
    return uploadedTrack;
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);
    throw error; // Propagate error to trigger job failure
  } finally {
    // Cleanup temp files
    await cleanupFiles(tempFiles);
    // Cleanup uploaded files in S3
    if (trackUrl) {
      await s3Service.deleteFile(trackUrl.key);
    }
    if (imageUrl) {
      await s3Service.deleteFile(imageUrl.key);
    }
  }
});

profilePictureUploadQueue.process("profile-picture", async (job) => {
  const { userId, imageUrl } = job.data;
  const tempFiles = [];

  try {
    // Download image file from s3
    job.progress("Downloading image file...");
    const { filePath } = await s3Service.downloadToTemp(imageUrl.key);
    tempFiles.push(filePath);

    // Validate and process the image
    job.progress("Processing image...");
    const { isValid, error } = await imageService.validateImage(filePath);
    if (!isValid) {
      throw new Error(error);
    }
    // Move the image file to its final location
    job.progress("Finalizing upload...");
    const finalizedImage = await s3Service.finalizeProfilePictureUpload(
      imageUrl.key,
      userId
    );

    // Delete previous profile picture, if any
    const userInfo = await getUserById(userId);
    const oldProfilePictureUrl = userInfo.profile_picture_url;

    if (oldProfilePictureUrl) {
      job.progress(`Deleting old profile picture: ${oldProfilePictureUrl}`);
      const oldKey = s3Service.getKeyFromPublicUrl(oldProfilePictureUrl);
      await s3Service.deleteFile(oldKey);
      // await s3Service.deleteFile(oldKey);
    }

    // update database
    const updatedUser = await updateUserOnDatabase(userId, { profile_picture_url: finalizedImage.url });

    job.progress("Upload complete!");
    console.log("Profile picture uploaded successfully:", updatedUser);

    return finalizedImage.url;
  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);
    throw error; // Propagate error to trigger job failure
  } finally {
    // Cleanup temp files
    await cleanupFiles(tempFiles);
    // Cleanup uploaded file in S3
    await s3Service.deleteFile(imageUrl.key);
  }
});


export { trackUploadQueue, profilePictureUploadQueue };

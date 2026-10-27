// services/uploadQueue.js
import Queue from 'bull';
import { audioService } from "../services/audioService.js";
import { imageService } from "../services/imageService.js";
import { s3Service } from "../services/s3Service.js";
import { deleteTrackFromDatabase, uploadTrackToDatabase, updateTrackOnDatabase } from "../controllers/trackController.js";
import { updateUserOnDatabase, getUserById } from '../controllers/userController.js';
import { cleanupFiles } from '../utils/cleanup.js';
import { isFinalJobAttempt } from './uploadJobPolicy.js';


const trackUploadQueue = new Queue('file-processing', process.env.REDIS_URL);
const profilePictureUploadQueue = new Queue('profile-picture-processing', process.env.REDIS_URL);


trackUploadQueue.process("track", async (job) => {
  const tempFiles = [];
  let uploadedTrack;
  let finalizedTrack;
  let finalizedCover;
  let completed = false;
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
      url: trackUrl.key,
      image_url: imageUrl?.key,
    };

    job.progress("Saving to database...");
    // Create database record
    uploadedTrack = await uploadTrackToDatabase(enrichedTrackData);

    
    // Move the track file to its final location
    job.progress("Finalizing upload...");
    try {
      if (imageUrl) {
        finalizedCover = await s3Service.finalizeCoverArtUpload(
          imageUrl.key,
          userId,
          uploadedTrack.id
        );
      }
      finalizedTrack = await s3Service.finalizeTrackUpload(
        trackUrl.key,
        userId,
        uploadedTrack.id
      );
      await updateTrackOnDatabase(uploadedTrack.id, {
        url: finalizedTrack.url,
        image_url: finalizedCover?.url || null,
      });
    } catch (moveError) {
      console.error('Failed to move files to final location:', moveError);
      throw new Error(`File movement failed: ${moveError.message}`);
    }

    job.progress("Upload complete!");

    completed = true;
    return {
      ...uploadedTrack,
      url: finalizedTrack.url,
      image_url: finalizedCover
        ? await s3Service.generateSecureUrl(finalizedCover.key)
        : null,
    };
  } catch (error) {
    if (uploadedTrack) {
      await deleteTrackFromDatabase(uploadedTrack.id).catch(() => {});
    }
    await Promise.allSettled([
      finalizedTrack?.key ? s3Service.deleteFile(finalizedTrack.key) : null,
      finalizedCover?.key ? s3Service.deleteFile(finalizedCover.key) : null,
    ]);
    console.error(`Job ${job.id} failed:`, error);
    throw error; // Propagate error to trigger job failure
  } finally {
    // Cleanup temp files
    await cleanupFiles(tempFiles);
    // Preserve staging objects for intermediate attempts. Delete them only
    // after success or after Bull has exhausted the configured retries.
    if (completed || isFinalJobAttempt(job)) {
      await Promise.allSettled([
        trackUrl ? s3Service.deleteFile(trackUrl.key) : null,
        imageUrl ? s3Service.deleteFile(imageUrl.key) : null,
      ]);
    }
  }
});

profilePictureUploadQueue.process("profile-picture", async (job) => {
  const { userId, imageUrl } = job.data;
  const tempFiles = [];
  let finalizedImage;
  let completed = false;

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
    finalizedImage = await s3Service.finalizeProfilePictureUpload(
      imageUrl.key,
      userId
    );

    // Commit the new reference before best-effort cleanup of the old object.
    const userInfo = await getUserById(userId);
    const oldProfilePictureUrl = userInfo.profile_picture_url;
    await updateUserOnDatabase(userId, { profile_picture_url: finalizedImage.url });

    if (oldProfilePictureUrl) {
      const oldKey = s3Service.getKeyFromPublicUrl(oldProfilePictureUrl);
      await s3Service.deleteFile(oldKey).catch((error) => {
        console.error("Unable to delete previous profile picture", {
          code: error.code || "STORAGE_DELETE_FAILED",
        });
      });
    }

    job.progress("Upload complete!");
    completed = true;
    return s3Service.generateSecureUrl(finalizedImage.key);
  } catch (error) {
    if (finalizedImage?.key) {
      await s3Service.deleteFile(finalizedImage.key).catch(() => {});
    }
    console.error(`Job ${job.id} failed:`, error);
    throw error; // Propagate error to trigger job failure
  } finally {
    // Cleanup temp files
    await cleanupFiles(tempFiles);
    if (completed || isFinalJobAttempt(job)) {
      await s3Service.deleteFile(imageUrl.key).catch(() => {});
    }
  }
});


export { trackUploadQueue, profilePictureUploadQueue };

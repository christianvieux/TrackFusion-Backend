import { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
import { getUserProfilePictureUrl } from "../controllers/userController.js";

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const azureStorageConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const blobServiceClient = BlobServiceClient.fromConnectionString(azureStorageConnectionString);

const ensureBlobContainerExists = async (containerName, publicAccess = false) => {
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const exists = await containerClient.exists();
  if (!exists) {
    await containerClient.create({ access: publicAccess ? 'container' : 'private' });
    console.log(`Container ${containerName} created`);
  } else if (publicAccess) {
    // Ensure the container access level is set to 'blob' if it already exists
    await containerClient.setAccessPolicy('blob');
  }
  return containerClient;
};

const uploadFileToBlob = async (file, containerName, blobName, metadata = {}) => {
  const metadataWithStrings = convertMetadataToStrings(metadata); // Convert metadata values to strings
  const containerClient = await ensureBlobContainerExists(containerName, true);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  const fileData = await fs.readFile(file.path);
  const uploadBlobResponse = await blockBlobClient.uploadData(fileData, {
    metadata: metadataWithStrings, // Use the converted metadata
    blobContentType: file.mimetype
  });

  console.log(`Uploaded ${blobName} successfully`, uploadBlobResponse.requestId);
  return blockBlobClient.url;
};

const convertMetadataToStrings = (metadata) => {
  const convertedMetadata = {};
  for (const key in metadata) {
    if (metadata.hasOwnProperty(key)) {
      convertedMetadata[key] = String(metadata[key]); // Ensure all metadata values are strings
    }
  }
  return convertedMetadata;
};

export async function uploadUserProfilePicture(file, userId, metaData = {}) {
  const containerName = process.env.USER_AVATARS_CONTAINER;
  const blobName = `${userId}/avatar${path.extname(file.originalname)}`;

  return uploadFileToBlob(file, containerName, blobName, { userId, ...metaData });
}

export async function updateUserProfilePicture(file, userId, metaData = {}) {
  const containerName = process.env.USER_AVATARS_CONTAINER;
  
  // First, delete the old profile picture if it exists
  const oldProfilePicUrl = await getUserProfilePictureUrl(userId);
  
  if (oldProfilePicUrl) {
    const { containerName: oldContainerName, blobPath: oldBlobName } = getBlobPathnameFromUrl(oldProfilePicUrl);
    await deleteBlob(oldContainerName, oldBlobName); // Delete the old profile picture
    console.log(`Deleted old profile picture for user ${userId}`);
  }

  // Now, upload the new profile picture
  const blobName = `${userId}/avatar${path.extname(file.originalname)}`;
  return uploadFileToBlob(file, containerName, blobName, { userId, ...metaData });
}

export async function uploadTrackFileToBlob(file, userId, trackId, metaData = {}) {
  const containerName = process.env.USER_TRACKS_CONTAINER;
  const blobName = `${userId}/${trackId}${path.extname(file.originalname)}`;
  return uploadFileToBlob(file, containerName, blobName, metaData);
};

export async function uploadTrackImageFileToBlob(file, trackId, metaData = {}) {
  const containerName = process.env.TRACK_COVERS_CONTAINER;
  const blobName = `${trackId}/cover${path.extname(file.originalname)}`;
  return uploadFileToBlob(file, containerName, blobName, metaData);
}

export async function generateSasToken(containerName, blobName) {
  const containerClient = blobServiceClient.getContainerClient(containerName);

  try {
    // Check if the container exists
    const containerExists = await containerClient.exists();
    if (!containerExists) {
      console.warn(`Warning: Container "${containerName}" does not exist.`);
      return null;  // Early exit if the container does not exist
    }

    const blobClient = containerClient.getBlobClient(blobName);

    // Check if the blob exists
    const blobExists = await blobClient.exists();
    if (!blobExists) {
      console.warn(`Warning: Blob "${blobName}" does not exist in container "${containerName}".`);
      return null;  // Early exit if the blob does not exist
    }

    // Generate SAS token
    const sasOptions = {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse("r"), // Read permission
      startsOn: new Date(),
      expiresOn: new Date(Date.now() + 3600 * 1000), // 1 hour expiration
    };

    const sasToken = generateBlobSASQueryParameters(sasOptions, blobServiceClient.credential).toString();
    return `${blobClient.url}?${sasToken}`;
  } catch (error) {
    console.error('Error generating SAS token:', error);
    return null;  // Return null in case of error
  }
}

export async function deleteBlob(containerName, blobName) {
  const containerClient = blobServiceClient.getContainerClient(containerName);

  try {
    // Check if the container exists
    const containerExists = await containerClient.exists();
    if (!containerExists) {
      console.warn(`Warning: Container "${containerName}" does not exist.`);
      return;  // Early exit since the container doesn't exist
    }

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Check if the blob exists
    const blobExists = await blockBlobClient.exists();
    if (!blobExists) {
      console.warn(`Warning: Blob "${blobName}" does not exist in container "${containerName}".`);
      return;  // Early exit since the blob doesn't exist
    }

    // If the blob exists, proceed with deletion
    await blockBlobClient.delete();
    console.log(`Blob "${blobName}" deleted successfully from container "${containerName}".`);
  } catch (error) {
    // Handle any other potential errors (like connection issues)
    console.error('Error deleting blob:', error);
  }
}

export function getBlobPathnameFromUrl(blobUrl) {
  try {
    const url = new URL(blobUrl);
    const containerName = url.pathname.split('/')[1]; // Extract the container name
    const blobPath = url.pathname.substring(containerName.length + 2); // Remove the container name and leading '/'
    return { containerName, blobPath };
  } catch (error) {
    console.error('Invalid URL:', error);
    throw new Error('Invalid URL');
  }
}
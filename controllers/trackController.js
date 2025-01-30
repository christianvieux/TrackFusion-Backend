import { queryToDatabase } from '../utils/queryUtils.js';
import NodeCache from 'node-cache';
import { s3Service } from '../services/s3Service.js';
const tokenCache = new NodeCache({ stdTTL: 300 }); // Cache for 5 minutes


// Update track on database
export async function updateTrackOnDatabase(trackId, properties) {
  // Construct the SET clause of the SQL query based on the properties of the object
  const setClause = Object.keys(properties)
    .map((key, index) => `${key} = $${index + 1}`)
    .join(', ');
  // Create the values array for the query
  const values = [...Object.values(properties), trackId];
  // Construct the SQL query with dynamic SET clause
  const query = `UPDATE tracks SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} RETURNING *`;

  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    throw error;
  }
}


// Create a new track
export async function uploadTrackToDatabase(trackData) {
  const query = `
    INSERT INTO tracks (name, artist, description, is_private, category, genre, mood, length, bpm, image_url, creator_id, sound_type, url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;
  const values = [
    trackData.name,
    trackData.artist,
    trackData.description,
    trackData.is_private,
    trackData.category,
    trackData.genre.split(','),
    trackData.mood.split(','),
    trackData["length"],
    trackData.bpm,
    trackData.image_url,
    trackData.creator_id,
    trackData.sound_type,
    trackData.url,
  ];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating track:', error);
    throw new Error('Failed to create track');
  }
};

// Get a track by ID
export async function getTrack(trackId) {
  const query = `
    SELECT tracks.*, 
           COUNT(track_interactions.track_id) AS favorites_count
    FROM tracks
    LEFT JOIN track_interactions 
           ON tracks.id = track_interactions.track_id 
           AND track_interactions.interaction_type = 'like'
    WHERE tracks.id = $1
    GROUP BY tracks.id
  `;
  const values = [trackId];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    throw error;
  }
}

// Get a track url by ID
export async function getTrackUrl(trackId) {
  const query = `SELECT url FROM tracks WHERE id = $1`;
  const values = [trackId];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0].url;
  } catch (error) {
    throw error;
  }
}

// authorize the track for playback
export async function authorizeTrackUrl(trackUrl) {
  try {
    const cacheKey = `track-${trackUrl}`;
    let authorizedUrl = tokenCache.get(cacheKey);

    if (!authorizedUrl) {
      // Extract the key from the S3 URL
      // Example URL format: https://bucket-name.s3.amazonaws.com/tracks/user-id/filename
      const urlObj = new URL(trackUrl);
      const key = urlObj.pathname.substring(1); // Remove leading slash
      
      // Generate a signed URL using the S3 service
      authorizedUrl = await s3Service.getTrackPlaybackUrl(key, 3600); // 1 hour expiration
      
      // Cache the authorized URL
      tokenCache.set(cacheKey, authorizedUrl, 3300); // Cache for 55 minutes
    }

    console.log('Authorized track URL:', authorizedUrl);
    return authorizedUrl;
  } catch (error) {
    console.error('Error authorizing track URL:', error);
    throw new Error(`Failed to authorize track URL: ${error.message}`);
  }
}

// Update a track by ID
export async function updateTrack(trackId, properties) {
  // Construct the SET clause of the SQL query based on the properties of the object
  const setClause = Object.keys(properties)
    .map((key, index) => `${key} = $${index + 1}`)
    .join(', ');
    // Create the values array for the query
  const values = [...Object.values(properties), trackId];
  // Construct the SQL query with dynamic SET clause
  const query = `UPDATE tracks SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} RETURNING *`;

  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    throw error;
  }
}

// Delete a track from database by ID
export async function deleteTrackFromDatabase(trackId) {
  const deleteInteractionsQuery = `DELETE FROM track_interactions WHERE track_id = $1`;
  const deleteTrackQuery = `DELETE FROM tracks WHERE id = $1 RETURNING *`;
  const query = `DELETE FROM tracks WHERE id = $1 RETURNING *`;
  const values = [trackId];

  try {
    // Start a transaction
    await queryToDatabase('BEGIN');
    
    // Delete related interactions
    await queryToDatabase(deleteInteractionsQuery, values);
    
    // Delete the track
    const result = await queryToDatabase(deleteTrackQuery, values);
    
    // Commit the transaction
    await queryToDatabase('COMMIT');

    console.log('Deleted track:', trackId, result.rows[0]);
    return result.rows[0]; // Return the deleted track
  } catch (error) {
    // Rollback the transaction in case of error
    await queryToDatabase('ROLLBACK');
    throw error;
  }
}

// Delete a track (Database and s3) by ID
export async function deleteTrack(trackId) {
  const track = await getTrack(trackId);
  if (!track) {
    throw new Error('Track not found');
  }
  try {
    // Delete the track file from S3
    await s3Service.deleteFile(s3Service.getKeyFromPublicUrl(track.url))

    // Delete the cover image from S3
    if (track.image_url) {
      await s3Service.deleteFile(s3Service.getKeyFromPublicUrl(track.image_url));
    }
    // Delete the track from the database
    return await deleteTrackFromDatabase(trackId);
  } catch (error) {
    throw error;
  }
}

// Get public tracks
export async function getPublicTracks() {
  const query = `
    SELECT tracks.*, 
           COUNT(track_interactions.track_id) AS favorites_count
    FROM tracks
    LEFT JOIN track_interactions 
           ON tracks.id = track_interactions.track_id 
           AND track_interactions.interaction_type = 'like'
    WHERE tracks.is_private = false
    GROUP BY tracks.id
  `;
  try {
    const result = await queryToDatabase(query);

    return result.rows;
  } catch (error) {
    throw error;
  }
}

// Get a user's favorite tracks
export async function getUserFavoriteTracks(userId) {
  const query = `
    SELECT tracks.*, 
           COUNT(track_interactions.track_id) AS favorites_count
    FROM tracks
    JOIN track_interactions 
      ON tracks.id = track_interactions.track_id 
      AND track_interactions.interaction_type = 'like'
    WHERE track_interactions.user_id = $1
    GROUP BY tracks.id
  `;
  const values = [userId];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

// Function to get a user's created tracks
export async function getUserTracks(userId) {
  const query = `
    SELECT tracks.*, 
           (SELECT COUNT(*) 
            FROM track_interactions 
            WHERE track_interactions.track_id = tracks.id 
              AND track_interactions.interaction_type = 'like') AS favorites_count
    FROM tracks 
    WHERE creator_id = $1
  `;
  const values = [userId];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

// Function to add a favorite track
export async function favoriteTrack(userId, trackId) {
  const query = `
    INSERT INTO track_interactions (user_id, track_id, interaction_type) 
    VALUES ($1, $2, 'like') 
    RETURNING *
  `;
  const values = [userId, trackId];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    throw error;
  }
}

// Function to remove a favorite track
export async function unfavoriteTrack(userId, trackId) {
  const query = `
    DELETE FROM track_interactions 
    WHERE user_id = $1 
      AND track_id = $2 
      AND interaction_type = 'like' 
    RETURNING *
  `;
  const values = [userId, trackId];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    throw error;
  }
}
// controllers/userController.js
import { queryToDatabase } from '../services/dbService.js';
import { normalizeEmail } from '../utils/emailUtils.js';

export async function updateUserOnDatabase(userId, properties) {
  const query = `UPDATE users SET ${Object.keys(properties).map((key, index) => `${key} = $${index + 2}`).join(', ')} WHERE id = $1 RETURNING *`;
  const values = [userId, ...Object.values(properties)];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    throw error;
  }
}

export async function getUser(userId) {
  const query = `SELECT * FROM users WHERE id = $1`;
  const values = [userId];

  try {
    const result = await queryToDatabase(query, values);
    const user = result.rows[0];

    if (user) {
      // Exclude password_hash from the returned user object
      delete user.password_hash;
    }

    return user;
  } catch (error) {
    throw error;
  }
}

export async function getUserInfo(email) {
  try {
    // Query the database for the user
    const query = "SELECT * FROM users WHERE LOWER(email) = $1";
    const result = await queryToDatabase(query, [normalizeEmail(email)]);

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];

    // Fetch additional user details
    const favoriteTracksQuery = "SELECT * FROM user_favorite_tracks WHERE user_id = $1";
    const ownedTracksQuery = "SELECT * FROM tracks WHERE creator_id = $1";

    const [favoriteTracksResult, ownedTracksResult] = await Promise.all([
      queryToDatabase(favoriteTracksQuery, [user.id]),
      queryToDatabase(ownedTracksQuery, [user.id])
    ]);

    user.favoriteTracks = favoriteTracksResult.rows;
    user.ownedTracks = ownedTracksResult.rows;

    return user;
  } catch (error) {
    console.error("Error fetching user info:", error);
    throw error;
  }
}

export async function isEmailRegistered(email) {
  const result = await queryToDatabase(
    "SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1",
    [normalizeEmail(email)],
  );
  return result.rows.length > 0;
}

export async function getUserById(userId) {
  const result = await queryToDatabase('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0];
}

export async function getUserProfilePictureUrl(userId) {
  // Query the database to retrieve the user's profile picture URL
  const result = await queryToDatabase('SELECT profile_picture_url FROM users WHERE id = $1', [userId]);
  
  // If the user exists and has a profile picture URL, return it
  if (result.rows.length > 0) {
    return result.rows[0].profile_picture_url;
  }

  // If no profile picture exists, return null or any appropriate default value
  return null;
}

export async function getPublicUserInfoFromId(userId) {
  const query = `SELECT id, username, profile_picture_url, updated_at, created_at FROM users WHERE id = $1`;
  const values = [userId];

  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    throw error;
  }
}

export async function getUserPublicFavoriteTracks(userId) {
  const query = `
    SELECT tracks.*, 
           COUNT(track_interactions.track_id) AS favorites_count
    FROM tracks
    JOIN track_interactions 
      ON tracks.id = track_interactions.track_id 
      AND track_interactions.interaction_type = 'like'
    WHERE track_interactions.user_id = $1
      AND tracks.is_private = false
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

export async function getUserPublicTracks(userId) {
  const query = `
    SELECT tracks.*, 
           (SELECT COUNT(*) 
            FROM track_interactions 
            WHERE track_interactions.track_id = tracks.id 
              AND track_interactions.interaction_type = 'like') AS favorites_count
    FROM tracks 
    WHERE creator_id = $1
      AND tracks.is_private = false
  `;
  const values = [userId];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows;
  } catch (error) {
    throw error;
  }
}


// Define other user-related functions (e.g., getUser, updateUser, deleteUser)

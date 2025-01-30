// routes/trackRoutes.js
import dotenv from 'dotenv'; dotenv.config();  // Load environment variables from .env file
import express from "express";
import Joi from 'joi';
import {
  getTrack,
  updateTrack,
  deleteTrack,
  getPublicTracks,
  getUserFavoriteTracks,
  favoriteTrack,
  unfavoriteTrack,
  getUserTracks,
} from "../controllers/trackController.js";
import { authorizeTrackUrl } from "../controllers/trackController.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";

const router = express.Router();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_ENABLED = false;
const DELAY_TIME = parseInt(process.env.DELAY_TIME) || 10000; // Default delay time is 1000ms


// Route to get authorized URL for a track
router.get("/:id/authorized-url", async (req, res) => {
  const { id } = req.params;
  const userId = req.session.user?.id;
  console.log(
    `Fetching authorized URL for track ID: ${id} by user ID: ${userId}`
  );
  if (DELAY_ENABLED) await delay(DELAY_TIME);

  try {
    const track = await getTrack(id);
    console.log(`Track fetched: ${JSON.stringify(track)}`, track.is_private);

    if (!track || (track.is_private && track.creator_id !== userId)) {
      console.warn(
        `Unauthorized access attempt by user ID: ${userId} for track ID: ${id}`
      );
      return res
        .status(403)
        .json({ error: "Track does not exist or Unauthorized" });
    }

    const randomId = Math.random().toString(36).substring(7);
    const authorizedUrl = await authorizeTrackUrl(track.url);
    console.log(`Authorized URL generated: ${authorizedUrl}, randomId: ${randomId}`);
    res.json({ url: authorizedUrl, randomId });
  } catch (error) {
    console.error("Error fetching authorized URL for track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to get a user's created tracks
router.get("/user", authenticateToken, async (req, res) => {
  if (!req.session.user || !req.session.user.id) {
    return res.status(400).json({ error: "User not authenticated" });
  }
  const userId = req.session.user.id;
  try {
    const userTracks = await getUserTracks(userId);
    res.json(userTracks);
  } catch (error) {
    console.error("Error fetching user tracks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to get public tracks
router.get("/public", async (req, res) => {
  try {
    const publicTracks = await getPublicTracks();
    res.json(publicTracks);
  } catch (error) {
    console.error("Error fetching public tracks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to get user's favorite tracks
router.get("/favorites", authenticateToken, async (req, res) => {
  if (!req.session.user || !req.session.user.id) {
    return res.status(400).json({ error: "User not authenticated" });
  }
  const userId = req.session.user.id;
  try {
    const favoriteTracks = await getUserFavoriteTracks(userId);
    res.json(favoriteTracks);
  } catch (error) {
    console.error("Error fetching user favorite tracks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to remove a favorite track
router.delete("/favorites", authenticateToken, async (req, res) => {
  const userId = req.session.user.id;
  const { trackId } = req.body;
  try {
    const favorite = await unfavoriteTrack(userId, trackId);
    // Broadcast update via WebSocket
    // broadcastToUser(userId, {
    //   event: "FAVORITE_TRACK",
    //   action: "REMOVE",
    //   data: { track: favorite },
    // });
    console.log(
      `User ${userId} removed favorite track removed: ${JSON.stringify(
        favorite
      )}`
    );
    res.json(favorite);
  } catch (error) {
    console.error("Error removing favorite track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to favorite a track
router.post("/favorites", authenticateToken, async (req, res) => {
  const userId = req.session.user.id;
  const { trackId } = req.body;
  try {
    const favorite = await favoriteTrack(userId, trackId);
    // Broadcast update via WebSocket
    // broadcastToUser(userId, {
    //   "event": "FAVORITE_TRACK",
    //   "action": "ADD",
    //   data: { track: favorite },
    // });
    res.json(favorite);
  } catch (error) {
    console.error("Error adding favorite track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


////////////////////Make sure these stay at the very bottom/////////////////////////////////////

// router.get('/:id', getTrack);
router.get("/:id", async (req, res) => {
  const trackSchema = Joi.object({
    id: Joi.number().integer().required(),
  });

  const { id } = req.params;

  try {
    const { error, value } = trackSchema.validate({ id });
    if (error) {
      return res.status(400).send({ error: error.details[0].message });
    }

    const track = await getTrack(value.id);
    if (!track) {
      return res.status(404).json({ error: "Track not found or access denied" });
    }

    res.json(track);
  } catch (err) {
    console.error("Error fetching track:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  const trackId = req.params.id;
  const userId = req.session.user?.id;
  const { name, description, is_private } = req.body;

  // Validate input
  const errors = [];
  if (!name) {
    errors.push("Name is required");
  }
  if (!description) {
    errors.push("Description is required");
  }
  if (typeof is_private === "undefined") {
    errors.push("Privacy status (is_private) is required");
  }
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join(", ") });
  }

  try {
    // Fetch the track to ensure it exists and belongs to the user
    const track = await getTrack(trackId);
    if (!track || track.creator_id !== userId) {
      return res
        .status(404)
        .json({ error: "Track not found or access denied" });
    }

    // Update the track
    const updatedTrack = await updateTrack(trackId, {
      name,
      description,
      is_private,
    });
    res.json(updatedTrack);
    console.log(
      `User ${userId} updated track: ${trackId} with data: ${JSON.stringify(
        req.body
      )}`
    );
  } catch (error) {
    console.error("Error updating track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {

  console.log(req.cookies, req.session)
  const trackId = req.params.id;
  const userId = req.user.id;  // Change this line to use req.user

  try {
    const deletedTrack = await deleteTrack(trackId);

    if (deletedTrack) {
      console.log(`User ${userId} deleted track: ${deletedTrack}`);
    } else {
      return res
        .status(404)
        .json({ error: "Track not found or access denied" });
    }

    console.log(`User ${userId} deleted track: ${trackId}`);
    res.json({ message: "Track deleted successfully" });
  } catch (error) {
    console.error("Error deleting track:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

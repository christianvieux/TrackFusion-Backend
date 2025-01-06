// routes/publicRoutes.js

import express from "express";
import Joi from 'joi';
import { getUserPublicFavoriteTracks, getUserPublicTracks } from "../controllers/userController.js";

const router = express.Router();
const schema = Joi.object({
  userId: Joi.number().required().messages({
    'any.required': 'User ID is required',
    'number.base': 'User ID must be a number'
  })
});


// Route to get user's favorite tracks
router.get("/favorite-tracks/:userId", async (req, res) => {
  const { userId } = req.params;
  const { error } = schema.validate({ userId });

  // Check if validation failed
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  try {
    const favoriteTracks = await getUserPublicFavoriteTracks(userId);
    res.json(favoriteTracks);
  } catch (error) {
    console.error("Error fetching user favorite tracks:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tracks/:userId", async (req, res) => {
    const { userId } = req.params;
    const { error } = schema.validate({ userId });
  
    // Check if validation failed
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    try {
      const favoriteTracks = await getUserPublicTracks(userId);
      res.json(favoriteTracks);
    } catch (error) {
      console.error("Error fetching user favorite tracks:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

export default router
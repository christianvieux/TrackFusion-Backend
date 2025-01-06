// Backend/routes/enumRoutes.js
import express from 'express';
import { getEnumValues } from '../controllers/enumController.js';

const router = express.Router();

router.get("/trackAttributes", async (req, res) => {
  try {
    const mood = await getEnumValues("mood");
    const genre = await getEnumValues("genre");
    const category = await getEnumValues("category");
    const trackAttributes = {
      mood: {
      allowMultiple: true,
      values: mood
      },
      genre: {
      allowMultiple: true,
      values: genre
      },
      category: {
      allowMultiple: false,
      values: category
      }
    };

    res.json(trackAttributes);
  } catch (error) {
    console.error("Error fetching track attributes:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get('/:type', async (req, res) => {
  const { type } = req.params;

  try {
    const values = await getEnumValues(type);
    res.json(values);
  } catch (error) {
    console.error('Error fetching enum values:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
// routes/uploadRoutes.js
import express from "express";
import Joi from "joi";
import { s3Service } from "../services/s3Service.js"
import { authenticateToken } from "../middlewares/authMiddleware.js";

const router = express.Router();
const presignedUrlSchema = Joi.object({
  fileName: Joi.string().max(255).required(),
  contentType: Joi.string().max(100).optional(),
  type: Joi.string().valid("track", "image", "profile-picture").optional(),
});

// Step 1: Get presigned URL for upload
router.post(
  "/presigned-url",
  authenticateToken,
  async (req, res) => {
    try {
      const { error, value } = presignedUrlSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { fileName, contentType } = value;
      const userId = req.user.id;

      // Get presigned URL
      const urls = await s3Service.getPresignedUploadUrl(userId, {
        fileName,
        contentType,
        folder: "uploads",
      });

      res.json(urls); // { key, uploadUrl, publicUrl }
    } catch (error) {
      console.error("Presigned URL generation error:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  }
);

export default router;

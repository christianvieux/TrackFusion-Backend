// routes/uploadRoutes.js
import express from "express";
import { s3Service } from "../services/s3Service.js"

const router = express.Router();

// Step 1: Get presigned URL for upload
router.post(
  "/presigned-url",
  // authenticateToken,
  async (req, res) => {
    try {
      // Validate request
      const { fileName } = req.body;
      const userId = 59; //req.session.user.id;

      // Get presigned URL
      const urls = await s3Service.getPresignedUploadUrl(userId, {
        fileName,
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

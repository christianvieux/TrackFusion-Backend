//routes/authRoute.js 
import express from 'express';
import { login, logout, checkSession, forgotPassword, resetPassword, verifyResetToken, updatePassword} from '../controllers/authController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { uploadImageSingle, handleUploadErrors } from '../middlewares/uploadMiddleware.js'
import { updateProfilePicture } from '../controllers/authController.js';
const router = express.Router();

router.post('/login', login);
router.post('/logout', logout);
router.get('/session', checkSession);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.get('/verify-reset-token/:token', verifyResetToken);
// Update password Authenticated
router.put("/update-password", authenticateToken, updatePassword);
router.put("/update-profile-picture",
  authenticateToken,
  uploadImageSingle,
  handleUploadErrors,
  updateProfilePicture
);

export default router;

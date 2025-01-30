//routes/authRoute.js 
import express from 'express';
import { login, logout, checkSession, forgotPassword, resetPassword, verifyResetToken, updatePassword} from '../controllers/authController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/login', login);
router.post('/logout', logout);
router.get('/session', checkSession);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);
router.get('/verify-reset-token/:token', verifyResetToken);
// Update password Authenticated
router.put("/password", authenticateToken, updatePassword);

export default router;

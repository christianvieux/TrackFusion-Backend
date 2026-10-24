//routes/authRoute.js 
import express from 'express';
import { login, logout, checkSession, forgotPassword, resetPassword, verifyResetToken, updatePassword} from '../controllers/authController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { authLimiter } from '../middlewares/limiterConfig.js';

const router = express.Router();

router.post('/login', authLimiter, login);
router.post('/logout', logout);
router.get('/session', checkSession);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password/:token', authLimiter, resetPassword);
router.get('/verify-reset-token/:token', verifyResetToken);
// Update password Authenticated
router.put("/password", authLimiter, authenticateToken, updatePassword);

export default router;

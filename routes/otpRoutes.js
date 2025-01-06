// Backend/routes/otpRoutes.js
import express from 'express';
import { generateOtp, verifyOtp, checkOtpCooldown } from '../controllers/otpController.js';

const router = express.Router();

// Route to generate a new OTP code
router.post('/generate', generateOtp);

// Route to verify an OTP code
router.post('/verify', verifyOtp);

// Route to check if OTP cooldown is active
router.get('/cooldown', checkOtpCooldown);

export default router;
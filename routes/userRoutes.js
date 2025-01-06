// routes/userRoutes.js
// env variables
import dotenv from 'dotenv';
dotenv.config();

import express from "express";
import { registerUser, getUserInfo, getPublicUserInfoFromId } from "../controllers/userController.js";
import { isOtpCodeValid, useOtpCode } from '../utils/otpUtils.js';
import { formatValidationError } from '../utils/validationsUtils.js';
import Joi from 'joi';


// Define the schema for validation
const registerSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.empty': 'Email is required',
      'string.email': 'Please enter a valid email address',
      'any.required': 'Email is required'
    }),
  username: Joi.string()
    .min(3)
    .max(20)
    .pattern(/^[a-zA-Z]/, 'start')
    .pattern(/^[a-zA-Z0-9-_]+$/, 'content')
    .pattern(/[a-zA-Z0-9]$/, 'end')
    .pattern(/^(?!.*[-_]{2})/, 'consecutive')
    .required()
    .messages({
      'string.empty': 'Username is required',
      'string.min': 'Username must be at least 3 characters long',
      'string.max': 'Username cannot exceed 20 characters',
      'string.pattern.start': 'Username must start with a letter',
      'string.pattern.content': 'Username can only contain letters, numbers, hyphens and underscores',
      'string.pattern.end': 'Username must end with a letter or number',
      'string.pattern.consecutive': 'Username cannot contain consecutive special characters',
      'any.required': 'Username is required'
    }),
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.empty': 'Password is required',
      'string.min': 'Password must be at least 8 characters long',
      'any.required': 'Password is required'
    }),
  otp_code: Joi.string()
    .length(6)
    .pattern(/^[0-9]+$/)
    .required()
    .messages({
      'string.empty': 'Verification code is required',
      'string.length': 'Verification code must be 6 digits',
      'string.pattern.base': 'Verification code must contain only numbers',
      'any.required': 'Verification code is required'
    })
});

// Define the schema for validation
const schema = Joi.object({
  userId: Joi.number().required().messages({
    'any.required': 'User ID is required',
    'number.base': 'User ID must be a number'
  })
});

const router = express.Router();

router.post("/register",
  async (req, res) => {
    const { email, username, password, otp_code } = req.body;
    const { error } = registerSchema.validate({
      email,
      username,
      password,
      otp_code,
    });

    // Check if validation failed
    if (error) {
      return res.status(400).json({ error: formatValidationError(error) });
    }

    try {
      // Validate OTP before registration
      const { isValid, reason } = await isOtpCodeValid(email, otp_code, 'registration');
      if (!isValid) {
        return res.status(400).json({ error: `Invalid verification code: ${reason}` });
      }

      // Register user with optional profile picture
      const result = await registerUser(email, username, password);
      await useOtpCode(email, otp_code, 'registration');

      res.status(201).json({ result, message: "Successfully registered the user!" });
    } catch (error) {
      // Default error handling
      let statusCode = 500;  // Default to internal server error
      let errorMessage = error.message || "Internal server error";

      // Custom error handling based on message or code
      if (error.message === "Please wait before requesting a new verification code.") {
        statusCode = 429;  // Too many requests (rate limiting)
        errorMessage = error.message;
      } else if (error.message === "User already exists with this email") {
        statusCode = 409;  // Conflict: user already exists
        errorMessage = error.message;
      } else if (error.message === "Missing required fields" || error.message === "Invalid verification code") {
        statusCode = 400;  // Bad request (missing fields or invalid input)
        errorMessage = error.message;
      } else if (error.code === '23505') {  // PostgreSQL unique violation error code
        statusCode = 409;  // Conflict: username or email already exists
        errorMessage = "Username or email already exists";
      }

      // Send the error response with the appropriate status code
      res.status(statusCode).json({ error: errorMessage });
    }
  }
);

router.post("/check-email", async (req, res) => {
  const { email } = req.body;
  try {
    const userExists = await getUserInfo(email);
    if (userExists) {
      res.status(200).json({ message: "Email is already registered", exists: true });
    } else {
      res.status(200).json({ message: "Email is available", exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// route for getting public user info
router.get("/info/:userId", async (req, res) => {
  const { userId } = req.params;

  const { error } = schema.validate({ userId });

  // Check if validation failed
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const userInfo = await getPublicUserInfoFromId(userId);

    // Check if userInfo is valid
    if (!userInfo) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json(userInfo);
  } catch (error) {
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

// router.get('/:id', getUser);
// router.put('/:id', updateUser);
// router.delete('/:id', deleteUser);

export default router;

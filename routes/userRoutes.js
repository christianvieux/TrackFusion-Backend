// routes/userRoutes.js
import express from "express";
import {
  getPublicUserInfoFromId,
  isEmailRegistered,
} from "../controllers/userController.js";
import { register } from "../controllers/registrationController.js";
import { otpLimiter } from "../middlewares/limiterConfig.js";
import { formatValidationError } from '../utils/validationsUtils.js';
import Joi from 'joi';


// Define the schema for validation
const registerSchema = Joi.object({
  email: Joi.string()
    .trim()
    .lowercase()
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
    .optional()
    .messages({
      'string.empty': 'Verification code is required',
      'string.length': 'Verification code must be 6 digits',
      'string.pattern.base': 'Verification code must contain only numbers',
      'any.required': 'Verification code is required'
    }),
  registration_grant: Joi.string().min(32).max(256).optional(),
});

// Define the schema for validation
const schema = Joi.object({
  userId: Joi.number().required().messages({
    'any.required': 'User ID is required',
    'number.base': 'User ID must be a number'
  })
});

const emailSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Enter a valid email address",
    "any.required": "Email is required",
  }),
});

const router = express.Router();

router.post("/register",
  otpLimiter,
  async (req, res) => {
    const { error, value } = registerSchema.validate(req.body);

    // Check if validation failed
    if (error) {
      return res.status(400).json({ error: formatValidationError(error) });
    }

    req.body = value;
    return register(req, res);
  }
);

router.post("/check-email", async (req, res) => {
  const { error: validationError, value } = emailSchema.validate(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError.details[0].message });
  }

  try {
    const userExists = await isEmailRegistered(value.email);
    if (userExists) {
      res.status(200).json({ message: "Email is already registered", exists: true });
    } else {
      res.status(200).json({ message: "Email is available", exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
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

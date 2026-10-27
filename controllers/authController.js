// controllers/authController.js
import { queryToDatabase, withTransaction } from "../services/dbService.js";
import { comparePassword } from "../utils/passwordUtils.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { getUserInfo, getUserById } from "../controllers/userController.js";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from "../services/emailService.js";
import { normalizeEmail } from "../utils/emailUtils.js";
import { hashPassword } from "../utils/passwordUtils.js";
import bcrypt from "bcrypt";
import Joi from 'joi';
import { clearCookieOptions, tokenCookieOptions } from "../utils/cookieOptions.js";

const PASSWORD_RESET_EXPIRATION_MINUTES = 15;
const PASSWORD_RESET_REQUEST_LIMIT_PER_HOUR = 5;

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function logEmailFailure(message, error) {
  console.error(message, {
    code: error.code || "EMAIL_DELIVERY_FAILED",
    statusCode: error.statusCode,
  });
}

function initializeUserSession(req, res, userData) {
  // Generate JWT token
  const token = jwt.sign({ id: userData.id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  // Set the JWT token in the cookie with security flags
  res.cookie("token", token, tokenCookieOptions);

  // Set the user data in the session
  req.session.user = {
    id: userData.id,
    username: userData.username,
    email: userData.email,
  };
  
  return res.status(200).json({ message: "Login successful", user: req.session.user});
}

export async function authorizeSession(req, res, userEmail) {
  try {
    // Fetch user info
    const user = await getUserInfo(userEmail);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Excluding the password (sensitive info)
    delete user.password_hash;

    // Generate JWT token
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    // Set the JWT token in the cookie with security flags
    res.cookie("token", token, tokenCookieOptions);

    // Set the user data in the session
    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
    };

    return res.status(200).json({ message: "Session authorized", user: req.session.user });
  } catch (error) {
    console.error("Error during session authorization:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function login(req, res) {
  // Define the schema for validating email and password
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      'string.base': 'Email must be a string.',
      'string.empty': 'Email is required.',
      'string.email': 'Please provide a valid email address.',
      'any.required': 'Email is required.',
    }),
    password: Joi.string().required().messages({
      'string.base': 'Password must be a string.',
      'string.empty': 'Password is required.',
      'any.required': 'Password is required.',
    }),
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const { email, password } = value;
    // Fetch user info
    const user = await getUserInfo(email);

    if (!user) {
      return res.status(401).json({ error: "No account found with the provided email address. Please check your email or sign up if you don’t have an account." });
    }

    // Compare the provided password with the stored hashed password
    const isMatch = await comparePassword(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: "The password you entered is incorrect. Please try again or reset your password if you’ve forgotten it." });
    }

    // Excluding the password (sensitive info)
    delete user.password_hash;

    return initializeUserSession(req, res, user);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}

export async function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("sessionId", clearCookieOptions); // Clear the session cookie
    res.clearCookie("token", clearCookieOptions); // Clear the JWT cookie
    return res.status(200).json({ message: "Logout successful" });
  });
}

export function checkSession(req, res) {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.json({ user: null });
  }
}

export async function forgotPassword(req, res) {
  const responseMessage = "If an account exists for that email, a reset link has been sent";
  const { error: validationError, value } = Joi.object({
    email: Joi.string().trim().lowercase().email().required(),
  }).validate(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError.details[0].message });
  }

  const exposeDevelopmentToken =
    process.env.NODE_ENV === "development" &&
    process.env.EXPOSE_RESET_TOKEN_IN_DEVELOPMENT === "true";
  if (
    process.env.EMAIL_DELIVERY_ENABLED !== "true" &&
    !exposeDevelopmentToken
  ) {
    return res.status(200).json({ message: responseMessage });
  }

  try {
    const email = normalizeEmail(value.email);
    const userResult = await queryToDatabase(
      "SELECT id, email FROM users WHERE LOWER(email) = $1 LIMIT 1",
      [email],
    );
    if (userResult.rows.length === 0) {
      return res.status(200).json({ message: responseMessage });
    }
    const user = userResult.rows[0];

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashResetToken(token);
    const tokenCreated = await withTransaction(async (query) => {
      await query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`password-reset:${user.id}`],
      );
      const requestResult = await query(
        `SELECT
           COUNT(*) FILTER (
             WHERE created_at > NOW() - INTERVAL '1 hour'
           )::integer AS request_count,
           COALESCE(
             MAX(created_at) > NOW() - INTERVAL '60 seconds',
             FALSE
           ) AS cooldown_active
         FROM password_reset_tokens
         WHERE user_id = $1`,
        [user.id],
      );
      const {
        request_count: requestCount,
        cooldown_active: cooldownActive,
      } = requestResult.rows[0];
      if (cooldownActive || requestCount >= PASSWORD_RESET_REQUEST_LIMIT_PER_HOUR) {
        return false;
      }

      await query(
        "UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE",
        [user.id],
      );
      await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'))`,
        [user.id, tokenHash, PASSWORD_RESET_EXPIRATION_MINUTES],
      );
      return true;
    });

    if (!tokenCreated) {
      return res.status(200).json({ message: responseMessage });
    }

    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;
    if (process.env.EMAIL_DELIVERY_ENABLED === "true") {
      try {
        await sendPasswordResetEmail(user.email, resetLink);
      } catch (error) {
        await queryToDatabase(
          "UPDATE password_reset_tokens SET used = TRUE WHERE token_hash = $1",
          [tokenHash],
        );
        logEmailFailure("Unable to deliver password-reset email", error);
        return res.status(200).json({ message: responseMessage });
      }
    }

    const response = {
      message: responseMessage,
    };
    if (exposeDevelopmentToken) {
      response.resetToken = token;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error("Unable to process password-reset request", {
      code: error.code || "PASSWORD_RESET_REQUEST_FAILED",
    });
    return res.status(200).json({ message: responseMessage });
  }
}

export async function resetPassword(req, res) {
  const { token } = req.params;
  const { password } = req.body;
  
  const { error } = Joi.object({
    password: Joi.string().min(8).required(),
  }).validate({ password });
  if (!token || error) {
    return res.status(400).json({
      error: error?.details[0].message || "Token is required",
    });
  }

  try {
    const tokenHash = hashResetToken(token);
    const hashedPassword = await hashPassword(password);
    const resetUser = await withTransaction(async (query) => {
      const result = await query(
        `SELECT reset_token.id, reset_token.user_id, users.email
           FROM password_reset_tokens AS reset_token
           JOIN users ON users.id = reset_token.user_id
          WHERE reset_token.token_hash = $1
            AND reset_token.used = FALSE
            AND reset_token.expires_at > NOW()
          FOR UPDATE OF reset_token`,
        [tokenHash],
      );
      if (result.rows.length === 0) return null;

      const resetToken = result.rows[0];
      await query(
        "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [hashedPassword, resetToken.user_id],
      );
      await query(
        "UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE",
        [resetToken.user_id],
      );
      return { email: resetToken.email };
    });

    if (!resetUser) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    try {
      await sendPasswordChangedEmail(resetUser.email);
    } catch (error) {
      logEmailFailure("Unable to deliver password-change confirmation", error);
    }

    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error("Unable to reset password", {
      code: error.code || "PASSWORD_RESET_FAILED",
    });
    return res.status(500).json({ error: "Server error" });
  }
}

export async function verifyResetToken(req, res) {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    const result = await queryToDatabase(
      `SELECT 1 FROM password_reset_tokens
        WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW()`,
      [hashResetToken(token)],
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    return res.status(200).json({ message: "Token is valid" });
  } catch (error) {
    console.error("Unable to verify password-reset token", {
      code: error.code || "PASSWORD_RESET_VERIFICATION_FAILED",
    });
    return res.status(500).json({ error: "Server error" });
  }
}

export async function updateUserPassword(userId, hashedPassword) {
  await queryToDatabase('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hashedPassword]);
}

export async function updateUserProfilePictureInDatabase(userId, profilePictureUrl) {
  try {
    const query = `
      UPDATE users 
      SET profile_picture_url = $1
      WHERE id = $2
    `;

    const result = await queryToDatabase(query, [profilePictureUrl, userId]);
    return result;
  } catch (error) {
    console.error('Error updating profile picture:', error);
    throw new Error('Database update failed');
  }
}

export async function updatePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "User ID, current password, and new password are required" });
  }

  const { error } = Joi.string().min(8).required().validate(newPassword);
  if (error) {
    return res.status(400).json({ error: "New password must be at least 8 characters long" });
  }

  try {
    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await updateUserPassword(userId, hashedPassword);

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
}

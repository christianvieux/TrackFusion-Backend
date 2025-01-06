// controllers/authController.js
import { queryToDatabase } from "../utils/queryUtils.js";
import { comparePassword } from "../utils/passwordUtils.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config(); // Load environment variables from .env file
import { getUser, getUserInfo, getUserById } from "../controllers/userController.js";
import { sendPasswordResetCodeEmail } from "../utils/emailUtils.js";
import { hashPassword } from "../utils/passwordUtils.js";
import { updateUserProfilePicture as updateUserProfilePictureInAzure } from "../utils/azureBlob.js";
import bcrypt from "bcrypt";
import os from "os";
import multer from "multer";
import fs from 'fs/promises';  // Use fs.promises for async file handling
import Joi from 'joi';
const upload = multer({ dest: os.tmpdir() });

function initializeUserSession(req, res, userData) {
  // Generate JWT token
  const token = jwt.sign({ id: userData.id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  // Set the JWT token in the cookie with security flags
  res.cookie("token", token, { 
    httpOnly: true, 
    // secure: true, 
    // sameSite: "none"
   });

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
    res.cookie("token", token, { 
      httpOnly: true, 
      // secure: true, 
      // sameSite: "none"
    });

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
    res.clearCookie("connect.sid"); // Clear the session cookie
    res.clearCookie("token"); // Clear the JWT cookie
    return res.status(200).json({ message: "Logout successful" });
  });
}

export function checkSession(req, res) {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).send({ error: "No active session" });
  }
}

export async function forgotPassword(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    // Fetch user info
    const user = await getUserInfo(email);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Generate JWT token
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET_PASSWORD_RESET, {
      expiresIn: "15m",
    });

     // Store the token in the database
     await queryToDatabase('INSERT INTO password_reset_tokens (user_id, token) VALUES ($1, $2)', [user.id, token]);

    // Send password reset email with the token
    const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;
    await sendPasswordResetCodeEmail(email, resetLink);

    return res.status(200).json({ message: "Password reset link sent" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Server error" });
  }
};

export async function resetPassword(req, res) {
  const { token } = req.params;
  const { password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ error: "Token and password are required" });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET_PASSWORD_RESET);

    // Check if the token has already been used or expired
    const result = await queryToDatabase('SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND created_at > NOW() - INTERVAL \'15 minutes\'', [token]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    // Fetch user info
    const user = await getUser(decoded.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update the user's password
    const hashedPassword = await hashPassword(password);
    await queryToDatabase("UPDATE users SET password_hash = $1 WHERE id = $2", [hashedPassword, user.id]);

    // Mark the token as used
    await queryToDatabase('UPDATE password_reset_tokens SET used = TRUE WHERE token = $1', [token]);

    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(400).json({ error: "Invalid token" });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ error: "Token has expired" });
    } else {
      console.error('Error during password reset:', error);
      return res.status(500).json({ error: "Server error" });
    }
  }
}

export async function verifyResetToken(req, res) {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET_PASSWORD_RESET);

     // Check if the token has already been used or expired
     const result = await queryToDatabase('SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND created_at > NOW() - INTERVAL \'15 minutes\'', [token]);
     if (result.rows.length === 0) {
       return res.status(400).json({ error: "Invalid or expired token" });
     }

    const user = await getUser(decoded.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({ message: "Token is valid" });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(400).json({ error: "Token has expired" });
    } else {
      return res.status(500).json({ error: "Server error" });
    }
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

export async function updateProfilePicture(req, res) {
  const userId = req.session.user?.id;

  // Validate file upload
  if (!req.file) {
    return res.status(400).json({ error: "No profile picture uploaded" });
  }

  try {
    // Upload new profile picture to Azure Blob Storage
    const newProfilePictureUrl = await updateUserProfilePictureInAzure(
      req.file,
      userId,
      { source: "user_upload" }
    );

    // Update user's profile picture URL in the database
    await updateUserProfilePictureInDatabase(userId, newProfilePictureUrl);

    return res
      .status(200)
      .json({ url: newProfilePictureUrl, message: "Profile picture updated successfully" });
  } catch (error) {
    console.error("Error updating profile picture:", error);
    return res.status(500).json({ error: "Failed to update profile picture" });
  } finally {
    // Clean up temporary file
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path); // Ensure cleanup happens asynchronously
        // console.log("Temporary file deleted:", req.file.path);
      } catch (err) {
        console.error("Failed to delete temporary file:", err);
      }
    }
  }
}


export async function updatePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const userId = req.session.user?.id; // Assuming user ID is stored in req.user

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "User ID, current password, and new password are required" });
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

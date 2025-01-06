// middlewares/authMiddleware.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv'; dotenv.config();  // Load environment variables from .env file
import { getUserById } from '../controllers/userController.js';


export async function authenticateToken(req, res, next) {
  // if (1+1 == 2) {
  //   req.user = {id: 50}
  //   req.session.user = {
  //     id: 59,
  //     username: 'test_1',
  //     email: 'test@test.com',
  //   };
  //   return next()
  // }

  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'Access denied: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUserById(decoded.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Attach the user data to the request for use in subsequent middleware or route handlers
    req.user = user;
    next();
  } catch (error) {
    // Handle specific JWT validation errors
    if (error instanceof jwt.TokenExpiredError) {
      // Token is expired
      return res.status(401).json({ error: 'Token expired. Please log in again.' });
    }

    if (error instanceof jwt.JsonWebTokenError) {
      // Invalid token or signature mismatch
      return res.status(403).json({ error: 'Invalid token. Please log in again to authenticate.' });
    }

    // Generic catch for any other JWT-related errors
    console.error('Error authenticating token:', error);
    return res.status(403).json({ error: 'Invalid token: The provided token is either expired or not valid. Please log in again to authenticate.' })
  }
}

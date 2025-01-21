// middlewares/errorHandler.js
export const errorHandler = (err, req, res, next) => {
  // Log error for debugging
  console.error('Error:', err);

  // Ensure we're sending a valid HTTP response
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal Server Error'
    : err.message;

  res.status(status).json({
    error: {
      status,
      message
    }
  });
};
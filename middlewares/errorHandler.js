export const errorHandler = (err, req, res, next) => {
    if (err.code === 'CSRF_INVALID') {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    
    console.error(err.stack);
    res.status(err.status || 500).json({
      error: process.env.NODE_ENV === 'production' 
        ? 'Internal Server Error' 
        : err.message
    });
  };
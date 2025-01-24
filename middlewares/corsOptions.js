// corsOptions.js

import dotenv from 'dotenv';
dotenv.config();

// Helper function to normalize URLs
const normalizeUrl = (url) => {
  if (!url) return '';
  
  // Add https:// if no protocol specified
  const withProtocol = url.includes('://') ? url : `https://${url}`;
  // Remove trailing slashes and convert to lowercase
  return withProtocol.toLowerCase().replace(/\/+$/, '');
};

// Helper to generate variations of a domain
const getDomainVariations = (domain) => {
  const normalized = normalizeUrl(domain);
  const withoutProtocol = normalized.replace(/^https?:\/\//, '');
  return [
    normalized,                          // https://domain.com
    normalized.replace('www.', ''),      // https://domain.com (if www was present)
    `https://www.${withoutProtocol}`,    // https://www.domain.com
  ];
};

const ENV = {
  DOMAIN: process.env.DOMAIN || 'localhost',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  DEV_URLS: process.env.DEV_URLS?.split(',') || ['http://localhost:8080'],
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS?.split(',') || [],
};

// Generate allowed origins
const allowedOrigins = [
  ...getDomainVariations(ENV.FRONTEND_URL),
  ...ENV.CORS_ALLOWED_ORIGINS,
  ...(process.env.NODE_ENV === 'development' ? ENV.DEV_URLS : []),
].filter(Boolean);

console.log('Allowed Origins:', allowedOrigins);

const corsOptions = {
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc)
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = normalizeUrl(origin);
    
    if (allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.log(`CORS blocked origin: ${normalizedOrigin}`);
      callback(new Error(`Origin ${normalizedOrigin} not allowed by CORS`));
    }
  },
  credentials: true, // Allow credentials (cookies, authorization headers, etc)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400 // Cache preflight request results for 24 hours
};

export { corsOptions };

export default corsOptions;
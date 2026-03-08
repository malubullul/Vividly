const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for AI generation endpoints
 * 10 requests per 15 minutes per IP
 */
module.exports = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Too many requests, please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

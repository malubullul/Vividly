const rateLimit = require('express-rate-limit');

exports.generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Terlalu banyak request. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

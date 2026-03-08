const jwt = require('jsonwebtoken');

/**
 * JWT Auth Middleware
 * Expects: Authorization: Bearer <token>
 */
module.exports = function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — no token' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized — invalid token' });
  }
};

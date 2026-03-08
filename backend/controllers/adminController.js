const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');

const DB_PATH = path.join(__dirname, '../../database/gallery.json');

// POST /admin/login
exports.login = async (req, res) => {
  const { username, password } = req.body;

  if (username !== process.env.ADMIN_USERNAME) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH || '');
  // Dev fallback: allow plain password match if hash not set
  const devMatch = !process.env.ADMIN_PASSWORD_HASH && password === 'vividly2026';

  if (!valid && !devMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { username, role: 'admin' },
    process.env.JWT_SECRET || 'dev-secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  res.json({ success: true, token });
};

// POST /admin/logout
exports.logout = (req, res) => {
  // JWT is stateless — client just discards the token
  res.json({ success: true, message: 'Logged out' });
};

// GET /admin/stats
exports.stats = (req, res) => {
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    const active   = db.gallery.filter(i => i.active !== false);
    const byMode   = ['ALIVE','TRANSITION','CANVAS'].map(m => ({
      mode: m,
      count: active.filter(i => i.mode === m).length
    }));
    const withImage = active.filter(i => i.url).length;

    res.json({
      success: true,
      stats: {
        total: active.length,
        byMode,
        withImage,
        withGradient: active.length - withImage,
        lastUpdated: db.meta.lastUpdated
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
};

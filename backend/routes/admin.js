const router = require('express').Router();
const bcrypt = require('bcryptjs');
const path   = require('path');
const requireAuth = require('../middleware/auth');

// ── Login page ────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '../../admin/login.html'));
});

// ── Login POST ────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const validUser = username === (process.env.ADMIN_USERNAME || 'admin');
  const validPass = password === (process.env.ADMIN_PASSWORD || 'vividly2026');

  if (validUser && validPass) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ success: true, redirect: '/admin' });
  }
  res.status(401).json({ success: false, error: 'Username atau password salah' });
});

// ── Logout ────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ── Admin dashboard (protected) ──────────────
router.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../../admin/dashboard.html'));
});

// ── Check auth status (for JS polling) ───────
router.get('/check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

module.exports = router;

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const session    = require('express-session');
const path       = require('path');
const fs         = require('fs');

const galleryRoutes = require('./backend/routes/gallery');
const adminRoutes   = require('./backend/routes/admin');
const apiRoutes     = require('./backend/routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure upload dir exists ──────────────────
const uploadDir = path.join(__dirname, 'frontend/public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── Middleware ────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'vividly-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// ── Static files ──────────────────────────────
app.use(express.static(path.join(__dirname, 'frontend/public')));
app.use('/uploads', express.static(uploadDir));

// ── Routes ────────────────────────────────────
app.use('/api/gallery', galleryRoutes);
app.use('/api',         apiRoutes);
app.use('/admin',       adminRoutes);

// ── Frontend pages ────────────────────────────
app.get('/',                  (req, res) => res.sendFile(path.join(__dirname, 'frontend/public/index.html')));
app.get('/studio/alive',      (req, res) => res.sendFile(path.join(__dirname, 'frontend/pages/studio-alive.html')));
app.get('/studio/transition', (req, res) => res.sendFile(path.join(__dirname, 'frontend/pages/studio-transition.html')));
app.get('/studio/canvas',     (req, res) => res.sendFile(path.join(__dirname, 'frontend/pages/studio-canvas.html')));

// ── 404 ───────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬 Vividly running at http://localhost:${PORT}`);
  console.log(`🔧 Admin panel  at http://localhost:${PORT}/admin`);
  console.log(`📡 API          at http://localhost:${PORT}/api\n`);
});

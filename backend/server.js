require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const session = require('express-session');

const generateRoutes = require('./routes/generate');
const galleryRoutes = require('./routes/gallery');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'vividly-secret-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

/* ─── Static ─── */
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/admin', express.static(path.join(__dirname, '../admin')));
app.use('/public', express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

/* ─── API ─── */
app.use('/api/generate', generateRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/admin', adminRoutes);

/* ─── Pages ─── */
const pages = path.join(__dirname, '../frontend/pages');

app.get('/', (req, res) => res.sendFile(path.join(pages, 'index.html')));
// app.get('/studio-adegan', (req, res) => res.sendFile(path.join(pages, 'studio-adegan.html')));
// app.get('/studio-ghibah', (req, res) => res.sendFile(path.join(pages, 'studio-ghibah.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../admin/index.html')));

/* ─── Health ─── */
app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.0.0', modes: ['adegan', 'ghibah'] }));

/* ─── 404 ─── */
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const server = app.listen(PORT, () => {
  console.log(`\n✦ Vividly v2.0 running on http://localhost:${PORT}`);
  console.log(`  🎬 Studio ADEGAN → http://localhost:${PORT}/studio-adegan`);
  console.log(`  🗣️  Studio GHIBAH  → http://localhost:${PORT}/studio-ghibah`);
  console.log(`  ⚙️  API Key: ${process.env.ALIBABA_API_KEY ? '✅ Set' : '❌ Not set (demo mode)'}\n`);
});

// Set timeout to 10 minutes (600,000 ms) to prevent early connection closure during long generations
server.timeout = 600000;

module.exports = app;

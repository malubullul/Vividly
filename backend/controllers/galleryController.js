const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../database/gallery.json');

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// GET /api/gallery — public
exports.getAll = (req, res) => {
  try {
    const db = readDB();
    const items = db.gallery.filter(i => i.active !== false);
    res.json({ success: true, data: items, total: items.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read gallery' });
  }
};

// POST /api/gallery — admin
exports.create = (req, res) => {
  try {
    const db = readDB();
    const { label, mode, gradient } = req.body;
    const url = req.file ? `/public/uploads/${req.file.filename}` : null;

    const item = {
      id: db.meta.nextId++,
      label: label || 'Untitled',
      mode: mode || 'ALIVE',
      gradient: gradient || 'linear-gradient(155deg,#1e1b4b,#4338ca,#818cf8)',
      url,
      active: true,
      createdAt: new Date().toISOString()
    };

    db.gallery.push(item);
    db.meta.lastUpdated = new Date().toISOString().split('T')[0];
    writeDB(db);
    res.status(201).json({ success: true, data: item });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create item' });
  }
};

// PATCH /api/gallery/:id — admin
exports.update = (req, res) => {
  try {
    const db = readDB();
    const idx = db.gallery.findIndex(i => i.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    ['label','mode','gradient','active'].forEach(k => {
      if (req.body[k] !== undefined) db.gallery[idx][k] = req.body[k];
    });

    db.meta.lastUpdated = new Date().toISOString().split('T')[0];
    writeDB(db);
    res.json({ success: true, data: db.gallery[idx] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' });
  }
};

// POST /api/gallery/:id/image — admin swap image
exports.swapImage = (req, res) => {
  try {
    const db = readDB();
    const idx = db.gallery.findIndex(i => i.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    if (!req.file)  return res.status(400).json({ error: 'No file uploaded' });

    // Remove old file
    if (db.gallery[idx].url) {
      const old = path.join(__dirname, '../../', db.gallery[idx].url);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    db.gallery[idx].url = `/public/uploads/${req.file.filename}`;
    writeDB(db);
    res.json({ success: true, data: db.gallery[idx] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to swap image' });
  }
};

// DELETE /api/gallery/:id — admin soft delete
exports.remove = (req, res) => {
  try {
    const db = readDB();
    const active = db.gallery.filter(i => i.active !== false);
    if (active.length <= 7) {
      return res.status(400).json({ error: 'Minimum 7 active items required' });
    }
    const idx = db.gallery.findIndex(i => i.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    db.gallery[idx].active = false;
    writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
  }
};

// PATCH /api/gallery/reorder — admin
exports.reorder = (req, res) => {
  try {
    const db = readDB();
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array' });
    const reordered = order.map(id => db.gallery.find(i => i.id === parseInt(id))).filter(Boolean);
    const rest = db.gallery.filter(i => !order.map(Number).includes(i.id));
    db.gallery = [...reordered, ...rest];
    writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reorder' });
  }
};

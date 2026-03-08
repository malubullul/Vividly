const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'gallery.json');

function read() {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function write(data) {
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function getAll() {
  return read().items.filter(i => i.active).sort((a, b) => a.order - b.order);
}

function getById(id) {
  return read().items.find(i => i.id === parseInt(id));
}

function create(item) {
  const db = read();
  const newItem = {
    id:       db.nextId++,
    label:    item.label    || 'Untitled',
    mode:     item.mode     || 'ALIVE',
    gradient: item.gradient || null,
    url:      item.url      || null,
    active:   true,
    order:    db.items.length + 1
  };
  db.items.push(newItem);
  write(db);
  return newItem;
}

function update(id, changes) {
  const db = read();
  const idx = db.items.findIndex(i => i.id === parseInt(id));
  if (idx === -1) return null;
  db.items[idx] = { ...db.items[idx], ...changes };
  write(db);
  return db.items[idx];
}

function remove(id) {
  const db = read();
  const idx = db.items.findIndex(i => i.id === parseInt(id));
  if (idx === -1) return false;
  db.items.splice(idx, 1);
  // re-order
  db.items.forEach((item, i) => { item.order = i + 1; });
  write(db);
  return true;
}

function reorder(orderedIds) {
  const db = read();
  orderedIds.forEach((id, i) => {
    const item = db.items.find(x => x.id === parseInt(id));
    if (item) item.order = i + 1;
  });
  write(db);
}

module.exports = { getAll, getById, create, update, remove, reorder, read };

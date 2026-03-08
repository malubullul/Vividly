const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../database/gallery.json');

module.exports = {
  read:  () => JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')),
  write: (data) => fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)),
  path:  DB_PATH
};

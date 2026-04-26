const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join('C:\\Users\\Wise AI\\joycreate\\JoyCreate\\userData', 'sqlite.db');
console.log('DB:', dbPath);
const db = new Database(dbPath, { readonly: true });
for (const t of ['apps','chats','messages','agents','documents','knowledge_bases','agent_capabilities','library_items','studio_datasets']) {
  try {
    const c = db.prepare('SELECT COUNT(*) as n FROM ' + t).get();
    console.log(t + ':', c.n);
  } catch(e) {}
}
console.log('\n--- last 5 apps ---');
try {
  const apps = db.prepare('SELECT id, name, path FROM apps ORDER BY id DESC LIMIT 5').all();
  for (const a of apps) console.log('  #' + a.id, a.name, '->', a.path);
} catch(e) { console.log(e.message); }
db.close();

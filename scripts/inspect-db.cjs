const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(process.env.APPDATA, 'JoyCreate', 'sqlite.db');
console.log('DB:', dbPath);
const db = new Database(dbPath, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(t => t.name).join(', '));
const candidates = ['apps','chats','messages','agents','agent_configs','documents','knowledge_documents','knowledge_base','agent_swarms','templates'];
for (const t of candidates) {
  try {
    const c = db.prepare('SELECT COUNT(*) as n FROM ' + t).get();
    console.log(t + ':', c.n);
  } catch(e) { /* no table */ }
}
console.log('\n--- apps (last 10) ---');
try {
  const apps = db.prepare('SELECT id, name, path FROM apps ORDER BY id DESC LIMIT 10').all();
  for (const a of apps) console.log('  #' + a.id, a.name, '->', a.path);
} catch(e) { console.log('apps query error:', e.message); }
console.log('\n--- agents (last 10) ---');
try {
  const agents = db.prepare('SELECT id, name FROM agents ORDER BY id DESC LIMIT 10').all();
  for (const a of agents) console.log('  #' + a.id, a.name);
} catch(e) { console.log('agents query error:', e.message); }
db.close();

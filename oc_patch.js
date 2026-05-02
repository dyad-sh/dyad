// Patch openclaw.json: replace Anthropic model with Ollama
// Run AFTER stopping the daemon (no watcher = no revert)
const fs = require('fs');
const path = 'C:\\Users\\Wise AI\\.openclaw\\openclaw.json';

try {
  // Remove read-only if set
  try { fs.chmodSync(path, 0o666); } catch(e) { console.log('chmod skipped:', e.message); }

  // Read as raw buffer to preserve BOM and CRLF exactly
  const raw = fs.readFileSync(path);
  // Detect UTF-8 BOM (EF BB BF)
  const hasBom = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
  console.log('Has BOM:', hasBom, '  Size:', raw.length);

  // Work on the string portion (skip BOM for search)
  const content = raw.toString('utf8');
  const before = (content.match(/anthropic\/claude-[^"]+/g) || []);
  console.log('Occurrences before:', before);

  const patched = content.replaceAll('anthropic/claude-opus-4-7', 'ollama/llama3.1:8b-instruct-q4_K_M');

  if (before.length === 0) {
    console.log('Nothing to patch — model may already be changed or key is different.');
    process.exit(1);
  }

  // Write back as buffer, preserving exact encoding
  fs.writeFileSync(path, Buffer.from(patched, 'utf8'));
  console.log('Written. Verifying...');
  const verify = fs.readFileSync(path, 'utf8');
  const remaining = (verify.match(/anthropic\/claude-opus-4-7/g) || []);
  const newModel = (verify.match(/ollama\/llama3\.1:8b-instruct-q4_K_M/g) || []);
  console.log('Remaining anthropic/claude-opus-4-7:', remaining.length);
  console.log('New ollama model occurrences:', newModel.length);
  if (remaining.length === 0 && newModel.length > 0) {
    console.log('SUCCESS: model patched to ollama/llama3.1:8b-instruct-q4_K_M');
  } else {
    console.log('FAILED: check file manually');
    process.exit(1);
  }
} catch(e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}

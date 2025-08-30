const fs = require("fs");
const path = require("path");

function rmrf(p) {
  try {
    const full = path.resolve(p);
    fs.rmSync(full, { recursive: true, force: true });
    // Also handle older Node without rmSync
  } catch {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
          for (const f of fs.readdirSync(p)) {
            rmrf(path.join(p, f));
          }
          fs.rmdirSync(p);
        } else {
          fs.unlinkSync(p);
        }
      }
    } catch {}
  }
}

rmrf("out");
rmrf(path.join("scaffold", "node_modules"));
console.log("Clean complete");

#!/usr/bin/env node
/**
 * Copy non-TS assets (icons, node manifests) into the dist tree so n8n
 * can find them at runtime.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC_NODE = path.join(ROOT, "nodes", "JoyCreateMcp");
const DEST_NODE = path.join(ROOT, "dist", "nodes", "JoyCreateMcp");

fs.mkdirSync(DEST_NODE, { recursive: true });

for (const file of ["JoyCreateMcp.node.json", "joycreate.svg"]) {
  const from = path.join(SRC_NODE, file);
  const to = path.join(DEST_NODE, file);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, to);
  console.log(`copied ${file}`);
}

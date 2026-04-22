// Generates assets/icon/logo.png and assets/icon/logo.ico
// from assets/joycreate-logo.svg using sharp (already a dependency).
// Run: node scripts/generate-icons.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const svgPath = path.join(repoRoot, "assets", "joycreate-logo.svg");
const outDir = path.join(repoRoot, "assets", "icon");

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(svg, size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// Build an ICO file containing one PNG-encoded image per size.
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  const dirSize = headerSize + entrySize * count;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (icon)
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = dirSize;
  for (let i = 0; i < count; i++) {
    const png = pngBuffers[i];
    const size = sizes[i];
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size === 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // bytes in resource
    entry.writeUInt32LE(offset, 12); // offset
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

async function main() {
  const svg = await fs.readFile(svgPath);
  await fs.mkdir(outDir, { recursive: true });

  // Main PNG (used by Linux + as fallback)
  const mainPng = await renderPng(svg, 512);
  await fs.writeFile(path.join(outDir, "logo.png"), mainPng);

  // ICO with multiple sizes (Windows)
  const buffers = await Promise.all(ICO_SIZES.map((s) => renderPng(svg, s)));
  const ico = buildIco(buffers, ICO_SIZES);
  await fs.writeFile(path.join(outDir, "logo.ico"), ico);

  console.log("Wrote", path.join(outDir, "logo.png"));
  console.log("Wrote", path.join(outDir, "logo.ico"));
  console.log("Note: logo.icns (macOS) not regenerated; run iconutil/icns tooling on macOS if needed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

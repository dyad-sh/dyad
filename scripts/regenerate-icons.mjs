#!/usr/bin/env node
/**
 * Icon Regeneration Script
 *
 * Regenerates all icon files from the canonical ABBA SVG artwork.
 * This ensures consistency across all platforms and prevents shipping
 * incorrect (Dyad) icons.
 *
 * Usage: node scripts/regenerate-icons.mjs
 *
 * Outputs:
 *   - assets/brand/abba-logo-1024.png (canonical master)
 *   - assets/icon/logo.ico (Windows app icon - 16/32/48/64/128/256)
 *   - assets/icon/logo.icns (macOS app icon)
 *   - assets/icon/logo.png (Linux/general - 1024px)
 *   - assets/icon/tray.ico (Windows tray - 16/24/32/48/64)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import iconGen from "icon-gen";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const ASSETS_DIR = path.join(ROOT, "assets");
const ICON_DIR = path.join(ASSETS_DIR, "icon");
const BRAND_DIR = path.join(ASSETS_DIR, "brand");
const SVG_SOURCE = path.join(ASSETS_DIR, "logo.svg");
const TEMP_DIR = path.join(ROOT, ".icon-temp");

// Icon sizes
const APP_ICON_SIZES = [16, 32, 48, 64, 128, 256];
const TRAY_ICON_SIZES = [16, 24, 32, 48, 64];

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function renderSvgToPng(svgPath, outputPath, size) {
  const svgBuffer = fs.readFileSync(svgPath);
  await sharp(svgBuffer, { density: Math.round((size / 24) * 72) })
    .resize(size, size)
    .png()
    .toFile(outputPath);
  console.log(`  ✓ Generated ${size}x${size} PNG`);
}

async function generateIco(pngPaths, outputPath) {
  const pngBuffers = pngPaths.map((p) => fs.readFileSync(p));
  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(outputPath, icoBuffer);
  console.log(`  ✓ Generated ICO: ${path.basename(outputPath)}`);
}

async function main() {
  console.log("🎨 ABBA AI Icon Regeneration Script\n");

  if (!fs.existsSync(SVG_SOURCE)) {
    console.error(`❌ SVG source not found: ${SVG_SOURCE}`);
    process.exit(1);
  }

  await ensureDir(BRAND_DIR);
  await ensureDir(ICON_DIR);
  await ensureDir(TEMP_DIR);

  try {
    // Step 1: Generate canonical 1024px PNG
    console.log("1. Generating canonical master PNG (1024px)...");
    const masterPng = path.join(BRAND_DIR, "abba-logo-1024.png");
    await renderSvgToPng(SVG_SOURCE, masterPng, 1024);
    console.log(`   Saved: ${masterPng}\n`);

    // Step 2: Generate app icon PNGs
    console.log("2. Generating app icon PNGs...");
    const appPngs = [];
    for (const size of APP_ICON_SIZES) {
      const pngPath = path.join(TEMP_DIR, `icon-${size}.png`);
      await renderSvgToPng(SVG_SOURCE, pngPath, size);
      appPngs.push(pngPath);
    }
    console.log("");

    // Step 3: Generate logo.ico (Windows app icon)
    console.log("3. Generating logo.ico (Windows app icon)...");
    const logoIcoPath = path.join(ICON_DIR, "logo.ico");
    await generateIco(appPngs, logoIcoPath);
    console.log("");

    // Step 4: Generate tray icon PNGs
    console.log("4. Generating tray icon PNGs...");
    const trayPngs = [];
    for (const size of TRAY_ICON_SIZES) {
      const existingPath = path.join(TEMP_DIR, `icon-${size}.png`);
      if (fs.existsSync(existingPath)) {
        trayPngs.push(existingPath);
        console.log(`  ✓ Reusing ${size}x${size} PNG`);
      } else {
        const pngPath = path.join(TEMP_DIR, `tray-${size}.png`);
        await renderSvgToPng(SVG_SOURCE, pngPath, size);
        trayPngs.push(pngPath);
      }
    }
    console.log("");

    // Step 5: Generate tray.ico (Windows tray icon)
    console.log("5. Generating tray.ico (Windows tray icon)...");
    const trayIcoPath = path.join(ICON_DIR, "tray.ico");
    await generateIco(trayPngs, trayIcoPath);
    console.log("");

    // Step 6: Copy largest PNG as logo.png
    console.log("6. Generating logo.png (Linux/general)...");
    const logoPngPath = path.join(ICON_DIR, "logo.png");
    fs.copyFileSync(masterPng, logoPngPath);
    console.log(`  ✓ Copied master PNG to ${logoPngPath}\n`);

    // Step 7: Generate logo.icns (macOS app icon) using icon-gen
    console.log("7. Generating logo.icns (macOS app icon)...");
    await iconGen(masterPng, ICON_DIR, {
      report: false,
      icns: { name: "logo", sizes: [16, 32, 64, 128, 256, 512, 1024] },
      ico: false,
      favicon: false,
    });
    console.log(`  ✓ Generated ICNS: ${path.join(ICON_DIR, "logo.icns")}\n`);

    // Step 8: Cleanup temp files
    console.log("8. Cleaning up temporary files...");
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log("  ✓ Cleaned up temp directory\n");

    // Output hashes for verification
    console.log("📊 Generated Icon Hashes (SHA256):");
    const crypto = await import("crypto");

    const files = [
      path.join(BRAND_DIR, "abba-logo-1024.png"),
      path.join(ICON_DIR, "logo.ico"),
      path.join(ICON_DIR, "logo.icns"),
      path.join(ICON_DIR, "logo.png"),
      path.join(ICON_DIR, "tray.ico"),
    ];

    for (const file of files) {
      if (fs.existsSync(file)) {
        const hash = crypto
          .createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex")
          .toUpperCase();
        console.log(`  ${path.relative(ROOT, file)}: ${hash}`);
      }
    }

    console.log("\n✅ Icon regeneration complete!");
    console.log(
      "\n📝 Next steps:\n" +
        "   1. Commit the regenerated icons\n" +
        "   2. Update CI guardrails with the new hashes",
    );
  } catch (error) {
    console.error("❌ Error during icon generation:", error);
    process.exit(1);
  }
}

main();

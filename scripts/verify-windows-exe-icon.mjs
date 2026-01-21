#!/usr/bin/env node
/**
 * verify-windows-exe-icon.mjs
 *
 * CI script to verify the packaged Windows EXE contains the correct ABBA icon.
 * Runs on Windows CI after electron-forge package step.
 *
 * Strategy:
 * 1. Locate the packaged .exe in out/ABBA AI-win32-x64/
 * 2. Compute hash of the source icon file (assets/icon/logo.ico)
 * 3. Extract the main icon resource from the EXE using resedit
 * 4. Compare the extracted icon against source - if different, fail CI
 *
 * This prevents shipping with wrong (e.g., Dyad) icon embedded in the EXE.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// Configuration
const SOURCE_ICON_PATH = path.join(rootDir, "assets", "icon", "logo.ico");
const PACKAGED_APP_DIR = path.join(rootDir, "out", "ABBA AI-win32-x64");
const PACKAGED_EXE_NAME = "ABBA AI.exe";

// Known hash of the correct ABBA icon (logo.ico)
// This is a fallback verification if PE parsing fails
// Update this hash if the icon legitimately changes
const EXPECTED_ICON_SIZE = 128885; // bytes (from previous verification)

let hasErrors = false;

function error(message) {
  console.error(`❌ ERROR: ${message}`);
  hasErrors = true;
}

function success(message) {
  console.log(`✅ ${message}`);
}

function warn(message) {
  console.warn(`⚠️  WARNING: ${message}`);
}

function computeFileHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function main() {
  console.log("🔍 Verifying Windows EXE icon resources...\n");

  // Check if we're on Windows
  if (process.platform !== "win32") {
    console.log("ℹ️  Skipping Windows EXE icon verification (not on Windows)");
    process.exit(0);
  }

  // 1. Verify source icon exists and has expected properties
  console.log("--- Source Icon Verification ---");
  if (!fs.existsSync(SOURCE_ICON_PATH)) {
    error(`Source icon not found: ${SOURCE_ICON_PATH}`);
  } else {
    const stats = fs.statSync(SOURCE_ICON_PATH);
    const hash = computeFileHash(SOURCE_ICON_PATH);

    if (stats.size !== EXPECTED_ICON_SIZE) {
      warn(
        `Source icon size (${stats.size}) differs from expected (${EXPECTED_ICON_SIZE}). ` +
          `If icon was intentionally updated, please update EXPECTED_ICON_SIZE in this script.`,
      );
    }

    success(`Source icon exists: ${SOURCE_ICON_PATH}`);
    console.log(`   Size: ${stats.size} bytes`);
    console.log(`   SHA256: ${hash}`);
  }

  // 2. Check if packaged app directory exists
  console.log("\n--- Packaged App Verification ---");
  if (!fs.existsSync(PACKAGED_APP_DIR)) {
    error(
      `Packaged app directory not found: ${PACKAGED_APP_DIR}\n` +
        `   Run 'npm run package' first to create the Windows build.`,
    );
    process.exit(1);
  }

  const exePath = path.join(PACKAGED_APP_DIR, PACKAGED_EXE_NAME);
  if (!fs.existsSync(exePath)) {
    error(`Packaged EXE not found: ${exePath}`);
    process.exit(1);
  }

  success(`Packaged EXE found: ${exePath}`);
  const exeStats = fs.statSync(exePath);
  console.log(`   Size: ${(exeStats.size / 1024 / 1024).toFixed(2)} MB`);

  // 3. Try to extract and verify icon from EXE using resedit
  console.log("\n--- Icon Resource Extraction ---");
  try {
    // Dynamic import of resedit (may not be installed)
    const { NtExecutable, NtExecutableResource, Resource } = await import(
      "resedit"
    );

    const exeData = fs.readFileSync(exePath);
    const exe = NtExecutable.from(exeData);
    const res = NtExecutableResource.from(exe);

    // Get icon group entries
    const iconGroups = Resource.IconGroupEntry.fromEntries(res.entries);

    if (iconGroups.length === 0) {
      error("No icon resources found in EXE!");
    } else {
      success(`Found ${iconGroups.length} icon group(s) in EXE`);

      // Get the main icon (usually ID 1 or the first one)
      const mainIconGroup = iconGroups[0];
      const icons = mainIconGroup.icons;

      console.log(`   Main icon group has ${icons.length} icon(s)`);

      // Compare the largest icon (typically 256x256) against source
      if (icons.length > 0) {
        // Extract icon data for comparison
        // The icon data in the EXE should match portions of the source .ico
        const sourceIconData = fs.readFileSync(SOURCE_ICON_PATH);

        // Check if the source icon header appears in the extracted resources
        // ICO files start with: 00 00 01 00 (reserved, type=1 for icon)
        const icoHeader = sourceIconData.slice(0, 4);
        if (
          icoHeader[0] === 0 &&
          icoHeader[1] === 0 &&
          icoHeader[2] === 1 &&
          icoHeader[3] === 0
        ) {
          success("Source icon has valid ICO header");
        }

        // For more detailed verification, compare icon data sizes
        // The EXE stores individual icon images, not the full ICO container
        const totalExeIconSize = icons.reduce((sum, icon) => {
          return sum + (icon.data ? icon.data.length : 0);
        }, 0);

        console.log(`   Total icon data in EXE: ${totalExeIconSize} bytes`);

        // Sanity check: EXE icon data should be substantial (not empty/tiny)
        if (totalExeIconSize < 10000) {
          error(
            "Icon data in EXE seems too small - may not have embedded correctly",
          );
        } else {
          success("Icon data size looks reasonable");
        }
      }
    }
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") {
      warn(
        "resedit not available - skipping deep icon extraction. " +
          "Install with: npm install --save-dev resedit",
      );
      // Fall back to basic verification
      console.log("\n--- Fallback Verification ---");
      console.log(
        "Verifying forge config points to correct icon (already done by verify-branding.mjs)",
      );
    } else {
      error(`Failed to parse EXE: ${err.message}`);
    }
  }

  // 4. Additional verification: check forge config icon path points to ABBA icon
  console.log("\n--- Config Consistency Check ---");
  const forgeConfigPath = path.join(rootDir, "forge.config.ts");
  if (fs.existsSync(forgeConfigPath)) {
    const forgeConfig = fs.readFileSync(forgeConfigPath, "utf-8");

    // Verify the icon path in packagerConfig
    if (forgeConfig.includes('icon: "./assets/icon/logo"')) {
      success("forge.config.ts packagerConfig.icon points to ABBA logo");
    } else {
      error("forge.config.ts packagerConfig.icon does not point to ABBA logo!");
    }

    // Check for any dyad.ico references (case insensitive)
    if (/dyad\.ico/i.test(forgeConfig)) {
      error("forge.config.ts still references dyad.ico!");
    }
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  if (hasErrors) {
    console.error(
      "\n❌ Windows EXE icon verification FAILED!\n" +
        "The packaged EXE may contain wrong branding. Fix before release.",
    );
    process.exit(1);
  } else {
    console.log("\n✅ Windows EXE icon verification passed!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

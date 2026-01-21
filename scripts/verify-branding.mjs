#!/usr/bin/env node
/**
 * verify-branding.mjs
 *
 * Fast CI guardrail to ensure ABBA AI branding is correctly configured.
 * Exits with code 1 if any branding issues are found.
 *
 * Checks:
 * 1. forge.config.ts has correct packagerConfig.icon pointing to ABBA icon
 * 2. forge.config.ts MakerSquirrel has correct setupIcon for Windows installer
 * 3. forge.config.ts MakerSquirrel has appUserModelId set correctly
 * 4. No Dyad icon paths/names referenced in forge config
 * 5. main.ts sets app.setAppUserModelId correctly
 * 6. Icon files exist at expected paths
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

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

console.log("🔍 Verifying ABBA AI branding configuration...\n");

// 1. Check forge.config.ts
const forgeConfigPath = path.join(rootDir, "forge.config.ts");
if (!fs.existsSync(forgeConfigPath)) {
  error("forge.config.ts not found!");
} else {
  const forgeConfig = fs.readFileSync(forgeConfigPath, "utf-8");

  // Check packagerConfig.icon
  if (!forgeConfig.includes('icon: "./assets/icon/logo"')) {
    error(
      'packagerConfig.icon should be "./assets/icon/logo" (without extension)',
    );
  } else {
    success('packagerConfig.icon correctly set to "./assets/icon/logo"');
  }

  // Check MakerSquirrel setupIcon
  if (!forgeConfig.includes('setupIcon: "./assets/icon/logo.ico"')) {
    error('MakerSquirrel setupIcon should be "./assets/icon/logo.ico"');
  } else {
    success(
      'MakerSquirrel setupIcon correctly set to "./assets/icon/logo.ico"',
    );
  }

  // Check appUserModelId in MakerSquirrel config
  if (!forgeConfig.includes('appUserModelId: "ai.abba.desktop"')) {
    error(
      'MakerSquirrel should have appUserModelId: "ai.abba.desktop" for Windows taskbar identity',
    );
  } else {
    success('MakerSquirrel appUserModelId correctly set to "ai.abba.desktop"');
  }

  // Check for any remaining Dyad icon references (case-insensitive)
  const dyadIconPatterns = [
    /dyad\.ico/i,
    /dyad-icon/i,
    /icon.*dyad/i,
    /dyad.*icon/i,
  ];

  for (const pattern of dyadIconPatterns) {
    if (pattern.test(forgeConfig)) {
      error(`Found potential Dyad icon reference matching pattern: ${pattern}`);
    }
  }

  // Check iconUrl doesn't point to old dyad repo (should point to abba-ai repo)
  if (
    forgeConfig.includes("raw.githubusercontent.com/yosiwizman/dyad/") &&
    forgeConfig.includes("icon")
  ) {
    error(
      "iconUrl in forge.config.ts still points to the old dyad repository. Should use abba-ai repo.",
    );
  } else if (
    forgeConfig.includes("raw.githubusercontent.com/yosiwizman/abba-ai/")
  ) {
    success("iconUrl correctly points to abba-ai repository");
  }
}

// 2. Check main.ts for appUserModelId
const mainTsPath = path.join(rootDir, "src", "main.ts");
if (!fs.existsSync(mainTsPath)) {
  error("src/main.ts not found!");
} else {
  const mainTs = fs.readFileSync(mainTsPath, "utf-8");

  // Check for setAppUserModelId call
  if (!mainTs.includes('app.setAppUserModelId("ai.abba.desktop")')) {
    error(
      'main.ts should call app.setAppUserModelId("ai.abba.desktop") for Windows',
    );
  } else {
    success('main.ts correctly sets AppUserModelId to "ai.abba.desktop"');
  }

  // Check the actual AppUserModelId string doesn't contain dyad
  // (allow "dyad" elsewhere in main.ts for backward-compat deep links)
  const appIdMatch = mainTs.match(/setAppUserModelId\(["']([^"']+)["']\)/);
  if (appIdMatch && appIdMatch[1].toLowerCase().includes("dyad")) {
    error(`main.ts AppUserModelId "${appIdMatch[1]}" contains Dyad reference`);
  }
}

// 3. Check icon files exist
const iconDir = path.join(rootDir, "assets", "icon");
const requiredIcons = ["logo.ico", "logo.icns", "logo.png"];

for (const iconFile of requiredIcons) {
  const iconPath = path.join(iconDir, iconFile);
  if (!fs.existsSync(iconPath)) {
    error(`Required icon file missing: assets/icon/${iconFile}`);
  } else {
    const stats = fs.statSync(iconPath);
    if (stats.size < 1000) {
      warn(
        `Icon file assets/icon/${iconFile} seems too small (${stats.size} bytes)`,
      );
    } else {
      success(
        `Icon file exists: assets/icon/${iconFile} (${stats.size} bytes)`,
      );
    }
  }
}

// 4. Check package.json branding
const packageJsonPath = path.join(rootDir, "package.json");
if (!fs.existsSync(packageJsonPath)) {
  error("package.json not found!");
} else {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

  if (packageJson.name !== "abba-ai") {
    error(`package.json name should be "abba-ai", got "${packageJson.name}"`);
  } else {
    success('package.json name is "abba-ai"');
  }

  if (packageJson.productName !== "ABBA AI") {
    error(
      `package.json productName should be "ABBA AI", got "${packageJson.productName}"`,
    );
  } else {
    success('package.json productName is "ABBA AI"');
  }
}

// Summary
console.log("\n" + "=".repeat(50));
if (hasErrors) {
  console.error(
    "\n❌ Branding verification FAILED. Please fix the errors above.",
  );
  process.exit(1);
} else {
  console.log("\n✅ All branding checks passed!");
  process.exit(0);
}

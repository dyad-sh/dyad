#!/usr/bin/env node
/**
 * CI Guardrail: Verify Windows tray/taskbar icon configuration
 *
 * This script ensures:
 * 1. assets/icon/tray.ico exists
 * 2. main.ts references tray.ico for Windows BrowserWindow icon
 * 3. forge.config.ts includes tray.ico in extraResource
 *
 * Prevents regressions where Windows taskbar/notification area shows wrong icon.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const errors = [];

console.log("🔍 Verifying Windows tray icon configuration...\n");

// Check 1: tray.ico exists
const trayIcoPath = path.join(ROOT, "assets", "icon", "tray.ico");
if (!fs.existsSync(trayIcoPath)) {
  errors.push(`❌ Missing tray icon: ${trayIcoPath}`);
} else {
  const stats = fs.statSync(trayIcoPath);
  if (stats.size < 1000) {
    errors.push(
      `❌ tray.ico seems too small (${stats.size} bytes) - may be corrupted`,
    );
  } else {
    console.log(`✅ tray.ico exists (${stats.size} bytes)`);
  }
}

// Check 2: main.ts uses tray.ico for Windows
const mainTsPath = path.join(ROOT, "src", "main.ts");
const mainTsContent = fs.readFileSync(mainTsPath, "utf-8");

const hasTrayIcoReference = mainTsContent.includes("tray.ico");
const hasResolveWindowsIcon =
  mainTsContent.includes("resolveWindowsIcon") ||
  mainTsContent.includes("resolveWindowsIcon()");
const hasBrowserWindowIcon =
  mainTsContent.includes("icon: windowIcon") ||
  mainTsContent.includes("icon: nativeImage");
const hasPlatformCheck = mainTsContent.includes('process.platform === "win32"');

if (!hasTrayIcoReference) {
  errors.push(`❌ main.ts does not reference tray.ico`);
} else {
  console.log(`✅ main.ts references tray.ico`);
}

if (!hasResolveWindowsIcon) {
  errors.push(
    `❌ main.ts missing resolveWindowsIcon function for icon path resolution`,
  );
} else {
  console.log(`✅ main.ts has resolveWindowsIcon function`);
}

if (!hasBrowserWindowIcon) {
  errors.push(`❌ main.ts BrowserWindow does not have icon property set`);
} else {
  console.log(`✅ main.ts BrowserWindow has icon property`);
}

if (!hasPlatformCheck) {
  errors.push(`❌ main.ts missing Windows platform check for icon`);
} else {
  console.log(`✅ main.ts has Windows platform check`);
}

// Check 3: forge.config.ts includes tray.ico in extraResource
const forgeConfigPath = path.join(ROOT, "forge.config.ts");
const forgeConfigContent = fs.readFileSync(forgeConfigPath, "utf-8");

const hasExtraResourceTrayIco =
  forgeConfigContent.includes("tray.ico") &&
  forgeConfigContent.includes("extraResource");

if (!hasExtraResourceTrayIco) {
  errors.push(
    `❌ forge.config.ts does not include tray.ico in extraResource - packaged builds will fail`,
  );
} else {
  console.log(`✅ forge.config.ts includes tray.ico in extraResource`);
}

// Summary
console.log("");
if (errors.length > 0) {
  console.log("❌ Tray icon configuration verification FAILED:\n");
  errors.forEach((err) => console.log(`  ${err}`));
  console.log("\n💡 Fix: Ensure tray.ico exists and is properly configured.");
  console.log(
    "   See: https://www.electronjs.org/docs/latest/api/browser-window#new-browserwindowoptions",
  );
  process.exit(1);
} else {
  console.log("✅ All tray icon configuration checks passed!");
  process.exit(0);
}

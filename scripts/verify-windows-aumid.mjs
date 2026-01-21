#!/usr/bin/env node
/**
 * verify-windows-aumid.mjs
 *
 * CI guardrail to ensure Windows AUMID is correctly configured.
 * Squirrel.Windows creates shortcuts with AUMID pattern: com.squirrel.<name>.<name>
 * The app's setAppUserModelId() MUST match this pattern exactly.
 *
 * This script verifies:
 * 1. The shared windowsIdentity.ts exports correct constants
 * 2. WINDOWS_AUMID matches the computed Squirrel pattern
 * 3. main.ts imports and uses WINDOWS_AUMID (not a hardcoded string)
 * 4. MakerSquirrel "name" in forge.config.ts matches SQUIRREL_MAKER_NAME
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

console.log("🔍 Verifying Windows AUMID configuration...\\n");

// 1. Check windowsIdentity.ts exists and exports correct constants
const identityPath = path.join(rootDir, "src", "shared", "windowsIdentity.ts");
if (!fs.existsSync(identityPath)) {
  error("src/shared/windowsIdentity.ts not found!");
} else {
  const identityContent = fs.readFileSync(identityPath, "utf-8");

  // Check SQUIRREL_MAKER_NAME is defined
  const makerNameMatch = identityContent.match(
    /export\s+const\s+SQUIRREL_MAKER_NAME\s*=\s*["']([^"']+)["']/,
  );
  if (!makerNameMatch) {
    error("SQUIRREL_MAKER_NAME not found in windowsIdentity.ts");
  } else {
    const makerName = makerNameMatch[1];
    success(`SQUIRREL_MAKER_NAME = "${makerName}"`);

    // Verify WINDOWS_AUMID uses the template pattern
    if (
      identityContent.includes(
        "`com.squirrel.${SQUIRREL_MAKER_NAME}.${SQUIRREL_MAKER_NAME}`",
      )
    ) {
      success("WINDOWS_AUMID correctly uses template with SQUIRREL_MAKER_NAME");

      // Compute expected AUMID
      const expectedAumid = `com.squirrel.${makerName}.${makerName}`;
      console.log(`   Computed AUMID: ${expectedAumid}`);
    } else {
      error(
        "WINDOWS_AUMID should use template: `com.squirrel.${SQUIRREL_MAKER_NAME}.${SQUIRREL_MAKER_NAME}`",
      );
    }
  }
}

// 2. Check main.ts imports and uses WINDOWS_AUMID
console.log("\\n--- main.ts Verification ---");
const mainTsPath = path.join(rootDir, "src", "main.ts");
if (!fs.existsSync(mainTsPath)) {
  error("src/main.ts not found!");
} else {
  const mainTs = fs.readFileSync(mainTsPath, "utf-8");

  // Check for import
  if (
    mainTs.includes("import { WINDOWS_AUMID }") ||
    mainTs.includes("import { WINDOWS_AUMID,") ||
    mainTs.includes(", WINDOWS_AUMID }")
  ) {
    success("main.ts imports WINDOWS_AUMID from shared module");
  } else {
    error("main.ts should import WINDOWS_AUMID from ./shared/windowsIdentity");
  }

  // Check for usage with the constant (not hardcoded string)
  if (mainTs.includes("app.setAppUserModelId(WINDOWS_AUMID)")) {
    success("main.ts uses WINDOWS_AUMID constant (not hardcoded)");
  } else if (mainTs.includes("app.setAppUserModelId(")) {
    error(
      "main.ts calls setAppUserModelId but NOT with WINDOWS_AUMID constant - possible hardcoded string!",
    );
  } else {
    error("main.ts does not call app.setAppUserModelId()");
  }
}

// 3. Check forge.config.ts MakerSquirrel name matches
console.log("\\n--- forge.config.ts Verification ---");
const forgeConfigPath = path.join(rootDir, "forge.config.ts");
if (!fs.existsSync(forgeConfigPath)) {
  error("forge.config.ts not found!");
} else {
  const forgeConfig = fs.readFileSync(forgeConfigPath, "utf-8");
  const identityContent = fs.existsSync(identityPath)
    ? fs.readFileSync(identityPath, "utf-8")
    : "";

  // Extract SQUIRREL_MAKER_NAME from identity file
  const makerNameMatch = identityContent.match(
    /export\s+const\s+SQUIRREL_MAKER_NAME\s*=\s*["']([^"']+)["']/,
  );

  if (makerNameMatch) {
    const expectedName = makerNameMatch[1];

    // Check MakerSquirrel name in forge config
    // Look for name field that matches snake_case pattern (MakerSquirrel name, not protocol name)
    // MakerSquirrel name should be like "abba_ai" (snake_case)
    if (forgeConfig.includes(`name: "${expectedName}"`)) {
      success(`MakerSquirrel name "${expectedName}" found in forge.config.ts`);
    } else {
      error(
        `MakerSquirrel name "${expectedName}" NOT found in forge.config.ts`,
      );
    }
  }
}

// Summary
console.log("\\n" + "=".repeat(50));
if (hasErrors) {
  console.error(
    "\\n❌ Windows AUMID verification FAILED!\\n" +
      "AUMID mismatch causes wrong taskbar/shortcut icons on Windows.",
  );
  process.exit(1);
} else {
  console.log("\\n✅ Windows AUMID verification passed!");
  process.exit(0);
}

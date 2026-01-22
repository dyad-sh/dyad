#!/usr/bin/env node
/**
 * verify-brand-ids.mjs
 *
 * CI guardrail to ensure brand identifiers are consistent across:
 * - package.json (name, productName)
 * - forge.config.ts (MakerSquirrel name, publisher repo)
 * - WINDOWS_AUMID constant
 *
 * This prevents mismatched identifiers that cause Windows icon/shortcut issues.
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

console.log("🔍 Verifying brand identifier consistency...\n");

// Expected values
const EXPECTED = {
  packageName: "abba-ai",
  productName: "ABBA AI",
  squirrelMakerName: "abba_ai",
  publisherRepoName: "abba-ai",
  publisherOwner: "yosiwizman",
};

// Compute expected AUMID from Squirrel name
const expectedAumid = `com.squirrel.${EXPECTED.squirrelMakerName}.${EXPECTED.squirrelMakerName}`;

// 1. Check package.json
const packageJsonPath = path.join(rootDir, "package.json");
if (!fs.existsSync(packageJsonPath)) {
  error("package.json not found!");
} else {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

  if (packageJson.name !== EXPECTED.packageName) {
    error(`package.json name mismatch: expected "${EXPECTED.packageName}", got "${packageJson.name}"`);
  } else {
    success(`package.json name: "${packageJson.name}"`);
  }

  if (packageJson.productName !== EXPECTED.productName) {
    error(`package.json productName mismatch: expected "${EXPECTED.productName}", got "${packageJson.productName}"`);
  } else {
    success(`package.json productName: "${packageJson.productName}"`);
  }
}

// 2. Check forge.config.ts
const forgeConfigPath = path.join(rootDir, "forge.config.ts");
if (!fs.existsSync(forgeConfigPath)) {
  error("forge.config.ts not found!");
} else {
  const forgeConfig = fs.readFileSync(forgeConfigPath, "utf-8");

  // Check MakerSquirrel name
  const squirrelNameMatch = forgeConfig.match(/new MakerSquirrel\(\{[\s\S]*?name:\s*"([^"]+)"/);
  if (!squirrelNameMatch) {
    error("Could not find MakerSquirrel name in forge.config.ts");
  } else if (squirrelNameMatch[1] !== EXPECTED.squirrelMakerName) {
    error(`MakerSquirrel name mismatch: expected "${EXPECTED.squirrelMakerName}", got "${squirrelNameMatch[1]}"`);
  } else {
    success(`MakerSquirrel name: "${squirrelNameMatch[1]}"`);
  }

  // Check publisher repository name
  const repoNameMatch = forgeConfig.match(/repository:\s*\{[\s\S]*?name:\s*"([^"]+)"/);
  if (!repoNameMatch) {
    error("Could not find publisher repository name in forge.config.ts");
  } else if (repoNameMatch[1] !== EXPECTED.publisherRepoName) {
    error(`Publisher repo name mismatch: expected "${EXPECTED.publisherRepoName}", got "${repoNameMatch[1]}"`);
  } else {
    success(`Publisher repo name: "${repoNameMatch[1]}"`);
  }

  // Check publisher owner
  const ownerMatch = forgeConfig.match(/repository:\s*\{[\s\S]*?owner:\s*"([^"]+)"/);
  if (!ownerMatch) {
    error("Could not find publisher owner in forge.config.ts");
  } else if (ownerMatch[1] !== EXPECTED.publisherOwner) {
    error(`Publisher owner mismatch: expected "${EXPECTED.publisherOwner}", got "${ownerMatch[1]}"`);
  } else {
    success(`Publisher owner: "${ownerMatch[1]}"`);
  }
}

// 3. Check WINDOWS_AUMID in shared/windowsIdentity.ts
const windowsIdentityPath = path.join(rootDir, "src", "shared", "windowsIdentity.ts");
if (!fs.existsSync(windowsIdentityPath)) {
  error("src/shared/windowsIdentity.ts not found!");
} else {
  const windowsIdentity = fs.readFileSync(windowsIdentityPath, "utf-8");

  // Check SQUIRREL_MAKER_NAME
  const makerNameMatch = windowsIdentity.match(/SQUIRREL_MAKER_NAME\s*=\s*"([^"]+)"/);
  if (!makerNameMatch) {
    error("Could not find SQUIRREL_MAKER_NAME in windowsIdentity.ts");
  } else if (makerNameMatch[1] !== EXPECTED.squirrelMakerName) {
    error(`SQUIRREL_MAKER_NAME mismatch: expected "${EXPECTED.squirrelMakerName}", got "${makerNameMatch[1]}"`);
  } else {
    success(`SQUIRREL_MAKER_NAME: "${makerNameMatch[1]}"`);
  }

  // Verify AUMID is computed correctly (it should use the constant, not hardcoded)
  if (!windowsIdentity.includes("WINDOWS_AUMID = `com.squirrel.${SQUIRREL_MAKER_NAME}.${SQUIRREL_MAKER_NAME}`")) {
    error("WINDOWS_AUMID should be computed from SQUIRREL_MAKER_NAME constant");
  } else {
    success(`WINDOWS_AUMID computed correctly: "${expectedAumid}"`);
  }
}

// 4. Consistency check
console.log("\n📋 Consistency Summary:");
console.log(`   Package name:      ${EXPECTED.packageName}`);
console.log(`   Product name:      ${EXPECTED.productName}`);
console.log(`   Squirrel name:     ${EXPECTED.squirrelMakerName}`);
console.log(`   Publisher repo:    ${EXPECTED.publisherOwner}/${EXPECTED.publisherRepoName}`);
console.log(`   Windows AUMID:     ${expectedAumid}`);

// Summary
console.log("\n" + "=".repeat(50));
if (hasErrors) {
  console.error("\n❌ Brand ID verification FAILED. Please fix the errors above.");
  console.error("\nNote: Windows taskbar icons depend on AUMID matching Squirrel pattern.");
  console.error("See docs/BRAND_AUDIT.md for details.");
  process.exit(1);
} else {
  console.log("\n✅ All brand identifiers are consistent!");
  process.exit(0);
}

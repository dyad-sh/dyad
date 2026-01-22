#!/usr/bin/env node
/**
 * CI Guardrail: Verify Squirrel.Windows shortcut handler is properly configured
 *
 * This script ensures:
 * 1. squirrelShortcuts.ts exists and exports required functions
 * 2. main.ts imports and uses handleSquirrelEvent
 * 3. The handler performs shortcut refresh (removeShortcut + createShortcut)
 *
 * Prevents regressions where Windows shortcuts show wrong icons.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const errors = [];

console.log(
  "🔍 Verifying Squirrel.Windows shortcut handler configuration...\n",
);

// Check 1: squirrelShortcuts.ts exists
const squirrelShortcutsPath = path.join(
  ROOT,
  "src",
  "main",
  "squirrelShortcuts.ts",
);
if (!fs.existsSync(squirrelShortcutsPath)) {
  errors.push(
    `❌ Missing: ${squirrelShortcutsPath}\n   The Squirrel shortcut handler module is required for Windows icon fix.`,
  );
} else {
  console.log("✅ squirrelShortcuts.ts exists");

  const content = fs.readFileSync(squirrelShortcutsPath, "utf-8");

  // Check for required exports
  const requiredExports = [
    "detectSquirrelEvent",
    "getUpdateExePath",
    "getExeName",
    "buildShortcutArgs",
    "handleSquirrelEvent",
    "refreshShortcuts",
    "removeShortcuts",
    "SHORTCUT_LOCATIONS",
  ];

  for (const exp of requiredExports) {
    if (
      !content.includes(`export function ${exp}`) &&
      !content.includes(`export const ${exp}`) &&
      !content.includes(`export async function ${exp}`)
    ) {
      errors.push(`❌ Missing export: ${exp} in squirrelShortcuts.ts`);
    }
  }

  // Check for shortcut refresh logic (remove + create)
  if (
    !content.includes("removeShortcut") ||
    !content.includes("createShortcut")
  ) {
    errors.push(
      `❌ squirrelShortcuts.ts missing shortcut refresh logic (removeShortcut + createShortcut)`,
    );
  } else {
    console.log("✅ squirrelShortcuts.ts has shortcut refresh logic");
  }

  // Check for Desktop and StartMenu locations
  if (!content.includes("Desktop") || !content.includes("StartMenu")) {
    errors.push(
      `❌ squirrelShortcuts.ts missing Desktop or StartMenu shortcut locations`,
    );
  } else {
    console.log(
      "✅ squirrelShortcuts.ts includes Desktop and StartMenu locations",
    );
  }
}

// Check 2: main.ts uses the handler
const mainTsPath = path.join(ROOT, "src", "main.ts");
const mainTsContent = fs.readFileSync(mainTsPath, "utf-8");

if (!mainTsContent.includes("handleSquirrelEvent")) {
  errors.push(
    `❌ main.ts does not use handleSquirrelEvent\n   Squirrel events won't trigger shortcut refresh.`,
  );
} else {
  console.log("✅ main.ts imports and uses handleSquirrelEvent");
}

if (!mainTsContent.includes("./main/squirrelShortcuts")) {
  errors.push(`❌ main.ts does not import from ./main/squirrelShortcuts`);
} else {
  console.log("✅ main.ts imports squirrelShortcuts module");
}

// Check 3: NOT using the old electron-squirrel-startup (we replaced it)
if (mainTsContent.includes("electron-squirrel-startup")) {
  errors.push(
    `❌ main.ts still uses electron-squirrel-startup\n   This should be replaced with our custom handleSquirrelEvent.`,
  );
} else {
  console.log("✅ main.ts does NOT use electron-squirrel-startup (correct)");
}

// Check 4: Unit tests exist
const testPath = path.join(
  ROOT,
  "src",
  "__tests__",
  "squirrelShortcuts.test.ts",
);
if (!fs.existsSync(testPath)) {
  errors.push(`❌ Missing unit tests: ${testPath}`);
} else {
  console.log("✅ Unit tests exist for squirrelShortcuts");
}

// Summary
console.log("\n" + "=".repeat(60) + "\n");

if (errors.length > 0) {
  console.log("❌ Squirrel shortcut handler verification FAILED:\n");
  errors.forEach((e) => console.log(`  ${e}\n`));
  console.log(
    "💡 Fix: Ensure squirrelShortcuts.ts exists with proper shortcut refresh logic.",
  );
  process.exit(1);
}

console.log("✅ Squirrel shortcut handler is properly configured!");
process.exit(0);

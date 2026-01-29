#!/usr/bin/env node

/**
 * Vault Backup Entrypoints Verification Script
 *
 * This script verifies that user-facing backup entrypoints exist in the codebase:
 * 1. "Backup to Vault" menu item in Preview dropdown (ActionHeader.tsx)
 * 2. "Create Backup" CTA button in Vault empty state (VaultBackupList.tsx)
 *
 * This runs as part of CI to prevent accidental removal of backup discoverability.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Track errors
const errors = [];

function logSuccess(message) {
  console.log(`✅ ${message}`);
}

function logError(message) {
  console.log(`❌ ${message}`);
  errors.push(message);
}

/**
 * Verify ActionHeader.tsx has "Backup to Vault" menu item
 */
function verifyActionHeaderBackupItem() {
  console.log("\n📄 Checking ActionHeader.tsx for backup menu item...\n");

  const actionHeaderPath = path.join(
    ROOT_DIR,
    "src",
    "components",
    "preview_panel",
    "ActionHeader.tsx",
  );

  if (!fs.existsSync(actionHeaderPath)) {
    logError("ActionHeader.tsx not found");
    return;
  }

  const content = fs.readFileSync(actionHeaderPath, "utf-8");

  // Check for the backup menu item test ID
  if (content.includes('data-testid="backup-to-vault-menu-item"')) {
    logSuccess("Found backup-to-vault-menu-item test ID in ActionHeader.tsx");
  } else {
    logError(
      "ActionHeader.tsx is missing data-testid='backup-to-vault-menu-item'. " +
        "Users need a visible 'Backup to Vault' action in the Preview dropdown.",
    );
    return;
  }

  // Verify it's connected to vault:create-backup
  if (content.includes("vault:create-backup")) {
    logSuccess("ActionHeader.tsx calls vault:create-backup IPC");
  } else {
    logError(
      "ActionHeader.tsx does not call vault:create-backup. " +
        "The backup menu item must trigger the backup IPC handler.",
    );
  }

  // Verify CloudUpload icon is used for visual consistency
  if (content.includes("CloudUpload")) {
    logSuccess("ActionHeader.tsx uses CloudUpload icon for backup action");
  } else {
    logError("ActionHeader.tsx should use CloudUpload icon for backup action");
  }
}

/**
 * Verify VaultBackupList.tsx has "Create Backup" CTA
 */
function verifyVaultBackupListCTA() {
  console.log("\n📄 Checking VaultBackupList.tsx for Create Backup CTA...\n");

  const backupListPath = path.join(
    ROOT_DIR,
    "src",
    "components",
    "vault",
    "VaultBackupList.tsx",
  );

  if (!fs.existsSync(backupListPath)) {
    logError("VaultBackupList.tsx not found");
    return;
  }

  const content = fs.readFileSync(backupListPath, "utf-8");

  // Check for the CTA button test ID
  if (content.includes('data-testid="vault-create-backup-cta"')) {
    logSuccess("Found vault-create-backup-cta test ID in VaultBackupList.tsx");
  } else {
    logError(
      "VaultBackupList.tsx is missing data-testid='vault-create-backup-cta'. " +
        "Users need a visible 'Create Backup' button in the Vault empty state.",
    );
    return;
  }

  // Verify it's connected to vault:create-backup
  if (content.includes("vault:create-backup")) {
    logSuccess("VaultBackupList.tsx calls vault:create-backup IPC");
  } else {
    logError(
      "VaultBackupList.tsx does not call vault:create-backup. " +
        "The Create Backup CTA must trigger the backup IPC handler.",
    );
  }

  // Verify app picker exists for selecting which app to backup
  if (content.includes("SelectContent") && content.includes("apps.map")) {
    logSuccess("VaultBackupList.tsx has app picker for backup selection");
  } else {
    logError(
      "VaultBackupList.tsx should have an app picker so users can select which app to backup",
    );
  }
}

/**
 * Verify vault:create-backup IPC handler exists and uses correct path resolution
 */
function verifyBackupIPCHandler() {
  console.log("\n📄 Checking vault_handlers.ts for create-backup handler...\n");

  const handlersPath = path.join(
    ROOT_DIR,
    "src",
    "ipc",
    "handlers",
    "vault_handlers.ts",
  );

  if (!fs.existsSync(handlersPath)) {
    logError("vault_handlers.ts not found");
    return;
  }

  const content = fs.readFileSync(handlersPath, "utf-8");

  if (content.includes('"vault:create-backup"')) {
    logSuccess("vault_handlers.ts has vault:create-backup handler");
  } else {
    logError("vault_handlers.ts is missing vault:create-backup handler");
  }

  // CRITICAL: Verify backup uses getAbbaAppPath for path resolution
  // This prevents the ENOENT bug where backup tried to use Electron userData paths
  // instead of the real app workspace path (~/abba-ai-apps/<app-name>)
  if (content.includes("getAbbaAppPath")) {
    logSuccess(
      "vault_handlers.ts uses getAbbaAppPath for path resolution (required)",
    );
  } else {
    logError(
      "vault_handlers.ts MUST use getAbbaAppPath to resolve app paths. " +
        "Without this, backup will fail with ENOENT on Windows because it would " +
        "try to use Electron userData paths (AppData/Local/abba_ai/app-x.x.x/) " +
        "instead of the real workspace path (~/abba-ai-apps/<app-name>).",
    );
  }

  // Verify existence check is present
  if (
    content.includes("fs.existsSync") &&
    content.includes("Project folder not found")
  ) {
    logSuccess(
      "vault_handlers.ts validates project folder exists before backup",
    );
  } else {
    logError(
      "vault_handlers.ts should check if project folder exists before backup " +
        "and provide a clear error message if it's missing.",
    );
  }
}

/**
 * Verify preload.ts exposes vault:create-backup
 */
function verifyPreloadChannel() {
  console.log("\n📄 Checking preload.ts for vault:create-backup channel...\n");

  const preloadPath = path.join(ROOT_DIR, "src", "preload.ts");

  if (!fs.existsSync(preloadPath)) {
    logError("preload.ts not found");
    return;
  }

  const content = fs.readFileSync(preloadPath, "utf-8");

  if (content.includes("vault:create-backup")) {
    logSuccess("preload.ts exposes vault:create-backup channel");
  } else {
    logError("preload.ts does not expose vault:create-backup channel");
  }
}

// Main execution
console.log("📦 Vault Backup Entrypoints Verification");
console.log("=".repeat(50));

verifyActionHeaderBackupItem();
verifyVaultBackupListCTA();
verifyBackupIPCHandler();
verifyPreloadChannel();

// Summary
console.log("\n" + "=".repeat(50));

if (errors.length === 0) {
  console.log("\n✅ All backup entrypoints verified!\n");
  console.log("Users can create backups via:");
  console.log("  1. Preview dropdown → 'Backup to Vault'");
  console.log("  2. Settings → Integrations → Vault → 'Create Backup'");
  console.log("");
  process.exit(0);
} else {
  console.log(`\n❌ ${errors.length} error(s) found:\n`);
  errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
  console.log("\nTo fix: Ensure backup entrypoints are visible to users.\n");
  process.exit(1);
}

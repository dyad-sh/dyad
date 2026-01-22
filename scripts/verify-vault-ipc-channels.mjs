#!/usr/bin/env node
/**
 * CI Guardrail: Verify Vault IPC Channel Configuration
 *
 * Ensures:
 * 1. All Vault channels used in renderer are in preload allowlist
 * 2. All allowlisted Vault channels have main process handlers
 * 3. Channel names match exactly (no typos)
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const errors = [];
const warnings = [];

console.log("🔍 Verifying Vault IPC Channel Configuration...\n");

// Define all Vault channels that should be configured
const VAULT_CHANNELS = [
  "vault:get-status",
  "vault:get-config",
  "vault:get-settings",
  "vault:save-settings",
  "vault:test-connection",
  "vault:get-diagnostics",
  "vault:list-backups",
  "vault:create-backup",
  "vault:restore-backup",
  "vault:delete-backup",
];

// 1. Check preload.ts has all Vault channels in allowlist
console.log("📋 Checking preload.ts allowlist...\n");

const preloadPath = join(projectRoot, "src", "preload.ts");
if (!existsSync(preloadPath)) {
  errors.push("❌ preload.ts not found");
} else {
  const preloadContent = readFileSync(preloadPath, "utf-8");

  for (const channel of VAULT_CHANNELS) {
    if (preloadContent.includes(`"${channel}"`)) {
      console.log(`  ✅ ${channel} in allowlist`);
    } else {
      errors.push(`❌ ${channel} NOT in preload allowlist`);
    }
  }
}

// 2. Check vault_handlers.ts has handlers for all channels
console.log("\n🔧 Checking vault_handlers.ts for handler registration...\n");

const handlersPath = join(
  projectRoot,
  "src",
  "ipc",
  "handlers",
  "vault_handlers.ts",
);
if (!existsSync(handlersPath)) {
  errors.push("❌ vault_handlers.ts not found");
} else {
  const handlersContent = readFileSync(handlersPath, "utf-8");

  for (const channel of VAULT_CHANNELS) {
    // Check for handle("channel-name" pattern
    if (handlersContent.includes(`"${channel}"`)) {
      console.log(`  ✅ ${channel} handler registered`);
    } else {
      errors.push(`❌ ${channel} handler NOT found in vault_handlers.ts`);
    }
  }
}

// 3. Check renderer components use channels that exist in allowlist
console.log("\n🖥️  Checking renderer components for channel usage...\n");

const rendererFiles = [
  "src/components/vault/VaultSettings.tsx",
  "src/components/vault/VaultBackupList.tsx",
  "src/components/vault/VaultBackupButton.tsx",
  "src/components/VaultIntegration.tsx",
];

const preloadContent = existsSync(preloadPath)
  ? readFileSync(preloadPath, "utf-8")
  : "";

for (const file of rendererFiles) {
  const filePath = join(projectRoot, file);
  if (!existsSync(filePath)) {
    warnings.push(`⚠️  ${file} not found (may be expected)`);
    continue;
  }

  const content = readFileSync(filePath, "utf-8");
  // Find all vault: channel invocations
  const channelMatches = content.match(/"vault:[a-z-]+"/g) || [];

  for (const match of channelMatches) {
    const channel = match.slice(1, -1); // Remove quotes
    if (preloadContent.includes(`"${channel}"`)) {
      console.log(`  ✅ ${file}: ${channel} is allowlisted`);
    } else {
      errors.push(`❌ ${file}: ${channel} is NOT in preload allowlist`);
    }
  }
}

// Summary
console.log("\n" + "=".repeat(50));

if (warnings.length > 0) {
  console.log("\n⚠️  Warnings:");
  warnings.forEach((w) => console.log(`  ${w}`));
}

if (errors.length > 0) {
  console.log("\n❌ Errors:");
  errors.forEach((e) => console.log(`  ${e}`));
  console.log(`\n❌ Verification failed with ${errors.length} error(s)`);
  console.log(
    "\nTo fix: Add missing channels to validInvokeChannels in src/preload.ts",
  );
  process.exit(1);
} else {
  console.log("\n✅ All Vault IPC channels are properly configured!");
  process.exit(0);
}

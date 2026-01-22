#!/usr/bin/env node
/**
 * CI Guardrail: Verify VaultAuth Component Accessibility
 *
 * Ensures:
 * 1. VaultAuth component is rendered when not authenticated (isVaultAuthenticated=false)
 * 2. "sign in above" string does NOT appear in Vault UI components
 * 3. VaultAuth form is always reachable for unauthenticated users
 * 4. Auth reasons are properly used in UI components
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const errors = [];
const warnings = [];

console.log("🔍 Verifying VaultAuth Component Accessibility...\\n");

// 1. Check that VaultIntegration shows VaultAuth when not authenticated
const vaultIntegrationPath = join(
  projectRoot,
  "src/components/VaultIntegration.tsx",
);

if (!existsSync(vaultIntegrationPath)) {
  errors.push("❌ VaultIntegration component not found");
} else {
  const content = readFileSync(vaultIntegrationPath, "utf-8");

  // Check that VaultAuth is rendered when not authenticated
  if (
    content.includes("!isVaultAuthenticated") &&
    content.includes("<VaultAuth")
  ) {
    console.log("✅ VaultAuth is rendered when user is not authenticated");
  } else if (
    content.includes("!isAuthenticated") &&
    content.includes("<VaultAuth")
  ) {
    // Legacy check
    console.log(
      "✅ VaultAuth is rendered when user is not authenticated (legacy pattern)",
    );
  } else {
    errors.push(
      "❌ VaultAuth may not be rendered when user is unauthenticated - check VaultIntegration.tsx",
    );
  }

  // Check that auth types are clearly separated
  if (
    content.includes("isVaultAuthenticated") ||
    content.includes("Vault Project Auth") ||
    content.includes("Vault Auth:")
  ) {
    console.log(
      "✅ Vault project auth is clearly separated from org connection",
    );
  } else {
    warnings.push(
      "⚠️  Consider clarifying the distinction between Vault auth and Supabase org connection",
    );
  }
}

// 2. Check for forbidden "sign in above" patterns
console.log("\\n🚫 Checking for forbidden UI patterns...");

const vaultFiles = globSync("src/components/vault/**/*.tsx", {
  cwd: projectRoot,
});
vaultFiles.push("src/components/VaultIntegration.tsx");

const forbiddenPatterns = [
  /sign\s*in\s*(to\s*supabase\s*)?above/i,
  /click\s*(the\s*)?sign\s*in\s*button\s*above/i,
  /use\s*the\s*sign\s*in\s*above/i,
  /sign\s*in\s*to\s*supabase\s*to\s*use\s*vault/i,
];

let foundForbiddenPatterns = false;

for (const file of vaultFiles) {
  const filePath = join(projectRoot, file);
  if (!existsSync(filePath)) continue;

  const content = readFileSync(filePath, "utf-8");

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      errors.push(`❌ Forbidden pattern found in ${file}: ${pattern}`);
      foundForbiddenPatterns = true;
    }
  }
}

if (!foundForbiddenPatterns) {
  console.log('✅ No "sign in above" or similar confusing patterns found');
}

// 3. Check that auth reason enum is used consistently
console.log("\\n📋 Checking auth reason consistency...");

const expectedReasons = [
  "AUTHENTICATED",
  "NO_SESSION",
  "SESSION_EXPIRED",
  "TOKEN_REFRESH_FAILED",
  "CONFIG_MISSING",
];

// Check handlers
const handlersPath = join(projectRoot, "src/ipc/handlers/vault_handlers.ts");

if (existsSync(handlersPath)) {
  const handlersContent = readFileSync(handlersPath, "utf-8");

  let missingReasons = [];
  for (const reason of expectedReasons) {
    if (!handlersContent.includes(`"${reason}"`)) {
      missingReasons.push(reason);
    }
  }

  if (missingReasons.length === 0) {
    console.log(
      "✅ All expected auth reasons are defined in vault_handlers.ts",
    );
  } else {
    errors.push(
      `❌ Missing auth reasons in vault_handlers.ts: ${missingReasons.join(", ")}`,
    );
  }

  // Check that VaultAuthReason type is exported
  if (handlersContent.includes("export type VaultAuthReason")) {
    console.log("✅ VaultAuthReason type is exported");
  } else {
    warnings.push(
      "⚠️  VaultAuthReason type should be exported for consistency",
    );
  }
}

// 4. Check that VaultAuth uses auth reasons for messaging
const vaultAuthPath = join(projectRoot, "src/components/vault/VaultAuth.tsx");

if (existsSync(vaultAuthPath)) {
  const vaultAuthContent = readFileSync(vaultAuthPath, "utf-8");

  if (
    vaultAuthContent.includes("authStatus?.reason") ||
    vaultAuthContent.includes("reason:")
  ) {
    console.log("✅ VaultAuth component uses auth reason for messaging");
  } else {
    warnings.push(
      "⚠️  VaultAuth should display context-aware messages based on auth reason",
    );
  }

  // Check for refresh session action
  if (
    vaultAuthContent.includes("auth-refresh") ||
    vaultAuthContent.includes("refreshMutation")
  ) {
    console.log("✅ VaultAuth has refresh session capability");
  } else {
    warnings.push("⚠️  VaultAuth should have a refresh session action");
  }
}

// 5. Check preload allowlist includes auth-refresh
const preloadPath = join(projectRoot, "src/preload.ts");

if (existsSync(preloadPath)) {
  const preloadContent = readFileSync(preloadPath, "utf-8");

  if (preloadContent.includes("vault:auth-refresh")) {
    console.log("✅ vault:auth-refresh is in preload allowlist");
  } else {
    errors.push("❌ vault:auth-refresh is not in preload allowlist");
  }
}

// Summary
console.log("\\n" + "=".repeat(50));

if (warnings.length > 0) {
  console.log("\\n⚠️  Warnings:");
  warnings.forEach((w) => console.log(`  ${w}`));
}

if (errors.length > 0) {
  console.log("\\n❌ Errors:");
  errors.forEach((e) => console.log(`  ${e}`));
  console.log(`\\n❌ Verification failed with ${errors.length} error(s)`);
  process.exit(1);
} else {
  console.log("\\n✅ All VaultAuth accessibility checks passed!");
  process.exit(0);
}

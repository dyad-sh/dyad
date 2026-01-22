#!/usr/bin/env node
/**
 * CI Guardrail: Verify Vault Settings UI Implementation
 *
 * Ensures:
 * 1. Vault settings UI component exists
 * 2. Test Connection action exists
 * 3. No service_role keys in renderer code
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { globSync } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const errors = [];
const warnings = [];

console.log("🔍 Verifying Vault Settings UI implementation...\n");

// 1. Check that VaultSettings component exists
const vaultSettingsPath = join(
  projectRoot,
  "src/components/vault/VaultSettings.tsx",
);
if (!existsSync(vaultSettingsPath)) {
  errors.push(
    "❌ VaultSettings component not found at src/components/vault/VaultSettings.tsx",
  );
} else {
  console.log("✅ VaultSettings component exists");

  const vaultSettingsContent = readFileSync(vaultSettingsPath, "utf-8");

  // Check for required UI elements
  const requiredElements = [
    { pattern: /supabaseUrl/i, name: "Supabase URL input" },
    { pattern: /supabaseAnonKey|anonKey/i, name: "Publishable key input" },
    {
      pattern: /test.*connection|testConnection/i,
      name: "Test Connection button",
    },
    { pattern: /status/i, name: "Status indicator" },
  ];

  for (const { pattern, name } of requiredElements) {
    if (pattern.test(vaultSettingsContent)) {
      console.log(`  ✅ ${name} found`);
    } else {
      warnings.push(`⚠️  ${name} not clearly identified in VaultSettings`);
    }
  }
}

// 2. Check that vault handlers include test-connection
const vaultHandlersPath = join(
  projectRoot,
  "src/ipc/handlers/vault_handlers.ts",
);
if (!existsSync(vaultHandlersPath)) {
  errors.push(
    "❌ Vault handlers not found at src/ipc/handlers/vault_handlers.ts",
  );
} else {
  const handlersContent = readFileSync(vaultHandlersPath, "utf-8");

  if (/vault:test-connection/i.test(handlersContent)) {
    console.log("✅ Test Connection IPC handler exists");
  } else {
    errors.push(
      "❌ vault:test-connection handler not found in vault_handlers.ts",
    );
  }

  if (/vault:get-settings/i.test(handlersContent)) {
    console.log("✅ Get Settings IPC handler exists");
  } else {
    errors.push("❌ vault:get-settings handler not found");
  }

  if (/vault:save-settings/i.test(handlersContent)) {
    console.log("✅ Save Settings IPC handler exists");
  } else {
    errors.push("❌ vault:save-settings handler not found");
  }
}

// 3. Check that vault_config validation utilities exist
const vaultConfigPath = join(projectRoot, "src/vault/vault_config.ts");
if (!existsSync(vaultConfigPath)) {
  errors.push(
    "❌ Vault config utilities not found at src/vault/vault_config.ts",
  );
} else {
  const configContent = readFileSync(vaultConfigPath, "utf-8");

  const requiredFunctions = [
    "validateSupabaseUrl",
    "validateSupabaseAnonKey",
    "validateVaultConfig",
    "maskKey",
  ];

  for (const fn of requiredFunctions) {
    if (configContent.includes(fn)) {
      console.log(`  ✅ ${fn} function exists`);
    } else {
      errors.push(`❌ ${fn} function not found in vault_config.ts`);
    }
  }
}

// 4. CRITICAL: Check for service_role keys in renderer code
console.log("\n🔒 Scanning renderer code for service_role key leaks...");

const rendererFiles = globSync("src/**/*.{ts,tsx}", {
  cwd: projectRoot,
  ignore: ["**/node_modules/**", "**/*.test.ts", "**/*.test.tsx"],
});

const serviceRolePatterns = [
  /service_role/gi,
  /serviceRole(?!.*validation|.*check|.*error|.*reject)/gi,
  /SUPABASE_SERVICE_ROLE/gi,
];

let foundServiceRoleLeaks = false;

for (const file of rendererFiles) {
  // Skip main process files (they may legitimately reference service_role for validation)
  if (file.includes("src/main/") || file.includes("src/ipc/handlers/")) {
    continue;
  }

  // Skip validation utilities (they need to check for service_role patterns)
  if (file.includes("vault_config.ts")) {
    continue;
  }

  // Skip prompt templates (they may warn about service_role)
  if (file.includes("_prompt.ts") || file.includes("prompts/")) {
    continue;
  }

  // Skip schemas (validation schemas may reference service_role patterns)
  if (file.includes("schemas.ts")) {
    continue;
  }

  const filePath = join(projectRoot, file);
  const content = readFileSync(filePath, "utf-8");

  for (const pattern of serviceRolePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      // Check if it's just a validation/error message reference
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          const line = lines[i].toLowerCase();
          // Allow references in:
          // - Comments and documentation
          // - Error messages and warnings
          // - UI text warning users NOT to use service_role
          // - Validation/checking code
          if (
            line.includes("error") ||
            line.includes("reject") ||
            line.includes("validation") ||
            line.includes("//") ||
            line.includes("/*") ||
            line.includes("*") ||
            line.includes("contains") ||
            line.includes("looks like") ||
            line.includes("not the") ||
            line.includes("never use") ||
            line.includes("don't use") ||
            line.includes("forbidden") ||
            line.includes("pattern") ||
            line.includes("warning") ||
            line.includes("<strong>") ||
            line.includes("<p>") ||
            line.includes("help") ||
            line.includes("note")
          ) {
            continue;
          }
          errors.push(
            `❌ Potential service_role key reference in renderer: ${file}:${i + 1}`,
          );
          foundServiceRoleLeaks = true;
        }
      }
    }
  }
}

if (!foundServiceRoleLeaks) {
  console.log("✅ No service_role key leaks found in renderer code");
}

// 5. Check for unit tests
const testPath = join(projectRoot, "src/__tests__/vault_config.test.ts");
if (!existsSync(testPath)) {
  warnings.push("⚠️  No unit tests found for vault_config");
} else {
  console.log("✅ Unit tests exist for vault_config");
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
  process.exit(1);
} else {
  console.log("\n✅ All Vault Settings UI checks passed!");
  process.exit(0);
}

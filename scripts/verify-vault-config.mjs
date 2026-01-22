#!/usr/bin/env node

/**
 * Vault Configuration Verification Script
 *
 * This script runs as part of CI to verify:
 * 1. Required Edge Function directories exist
 * 2. Bucket name is exactly "abba-vault" in vault code
 * 3. Required env var keys are referenced (VAULT_SUPABASE_URL, VAULT_SUPABASE_ANON_KEY)
 * 4. Service role key env names are NOT referenced in client code
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Configuration
const REQUIRED_EDGE_FUNCTIONS = [
  "vault-signed-upload",
  "vault-signed-download",
  "vault-confirm-upload",
  "vault-list-backups",
  "vault-delete-backup",
];

const REQUIRED_BUCKET_NAME = "abba-vault";

const REQUIRED_ENV_VARS = ["VAULT_SUPABASE_URL", "VAULT_SUPABASE_ANON_KEY"];

const FORBIDDEN_ENV_VARS = [
  "VAULT_SUPABASE_SERVICE_ROLE_KEY",
  "VAULT_SERVICE_ROLE_KEY",
];

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
 * Check that all required Edge Functions exist
 */
function verifyEdgeFunctions() {
  console.log("\n📁 Verifying Edge Functions...\n");

  const functionsDir = path.join(ROOT_DIR, "supabase", "functions");

  if (!fs.existsSync(functionsDir)) {
    logError(`Edge functions directory not found: ${functionsDir}`);
    return;
  }

  for (const funcName of REQUIRED_EDGE_FUNCTIONS) {
    const funcDir = path.join(functionsDir, funcName);
    const indexFile = path.join(funcDir, "index.ts");

    if (!fs.existsSync(funcDir)) {
      logError(`Missing Edge Function directory: ${funcName}`);
    } else if (!fs.existsSync(indexFile)) {
      logError(`Missing index.ts in Edge Function: ${funcName}`);
    } else {
      logSuccess(`Edge Function exists: ${funcName}`);
    }
  }
}

/**
 * Verify bucket name is correctly set in Edge Functions
 */
function verifyBucketName() {
  console.log("\n🪣 Verifying Bucket Name...\n");

  const functionsDir = path.join(ROOT_DIR, "supabase", "functions");
  let bucketFound = false;

  for (const funcName of REQUIRED_EDGE_FUNCTIONS) {
    const indexFile = path.join(functionsDir, funcName, "index.ts");

    if (fs.existsSync(indexFile)) {
      const content = fs.readFileSync(indexFile, "utf-8");

      // Check for correct bucket name
      if (content.includes(`"${REQUIRED_BUCKET_NAME}"`)) {
        bucketFound = true;
        logSuccess(
          `Bucket name "${REQUIRED_BUCKET_NAME}" found in ${funcName}`,
        );
      }

      // Check for incorrect bucket names
      const bucketMatches = content.match(
        /BUCKET_NAME\s*=\s*["']([^"']+)["']/g,
      );
      if (bucketMatches) {
        for (const match of bucketMatches) {
          const name = match.match(/["']([^"']+)["']/)?.[1];
          if (name && name !== REQUIRED_BUCKET_NAME) {
            logError(
              `Incorrect bucket name "${name}" in ${funcName} (expected "${REQUIRED_BUCKET_NAME}")`,
            );
          }
        }
      }
    }
  }

  if (!bucketFound) {
    logError(
      `Bucket name "${REQUIRED_BUCKET_NAME}" not found in any Edge Function`,
    );
  }
}

/**
 * Verify required env vars are referenced in vault config or handlers
 */
function verifyEnvVarReferences() {
  console.log("\n🔑 Verifying Environment Variable References...\n");

  // Check multiple possible locations for env var references
  const vaultFilePaths = [
    path.join(ROOT_DIR, "src", "ipc", "handlers", "vault_handlers.ts"),
    path.join(ROOT_DIR, "src", "vault", "vault_config.ts"),
  ];

  let combinedContent = "";
  let foundFiles = [];

  for (const filePath of vaultFilePaths) {
    if (fs.existsSync(filePath)) {
      combinedContent += fs.readFileSync(filePath, "utf-8");
      foundFiles.push(path.relative(ROOT_DIR, filePath));
    }
  }

  if (foundFiles.length === 0) {
    logError("No vault config files found");
    return;
  }

  console.log(`  Checking files: ${foundFiles.join(", ")}\n`);

  // Check for required env vars
  for (const envVar of REQUIRED_ENV_VARS) {
    if (combinedContent.includes(envVar)) {
      logSuccess(`Required env var referenced: ${envVar}`);
    } else {
      logError(`Required env var NOT referenced: ${envVar}`);
    }
  }

  // Check that forbidden env vars are NOT referenced in client code
  const clientSrcDir = path.join(ROOT_DIR, "src");
  checkForbiddenEnvVars(clientSrcDir);
}

/**
 * Recursively check for forbidden env var references in client code
 */
function checkForbiddenEnvVars(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      // Skip node_modules and test directories
      if (file.name !== "node_modules" && !file.name.startsWith("__")) {
        checkForbiddenEnvVars(fullPath);
      }
    } else if (file.name.endsWith(".ts") || file.name.endsWith(".tsx")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      const relativePath = path.relative(ROOT_DIR, fullPath);

      for (const envVar of FORBIDDEN_ENV_VARS) {
        if (content.includes(envVar)) {
          logError(
            `Forbidden env var "${envVar}" found in client code: ${relativePath}`,
          );
        }
      }
    }
  }
}

/**
 * Verify migration file exists and has bucket creation
 */
function verifyMigration() {
  console.log("\n📄 Verifying Migration...\n");

  const migrationsDir = path.join(ROOT_DIR, "supabase", "migrations");

  if (!fs.existsSync(migrationsDir)) {
    logError("Migrations directory not found");
    return;
  }

  const files = fs.readdirSync(migrationsDir);
  const vaultMigration = files.find((f) => f.includes("vault"));

  if (!vaultMigration) {
    logError("No vault migration file found");
    return;
  }

  const migrationPath = path.join(migrationsDir, vaultMigration);
  const content = fs.readFileSync(migrationPath, "utf-8");

  logSuccess(`Vault migration found: ${vaultMigration}`);

  // Check for bucket creation
  if (
    content.includes("storage.buckets") &&
    content.includes(REQUIRED_BUCKET_NAME)
  ) {
    logSuccess(`Bucket creation found in migration`);
  } else {
    logError(
      `Bucket creation for "${REQUIRED_BUCKET_NAME}" not found in migration`,
    );
  }

  // Check for RLS policies
  if (
    content.includes("ROW LEVEL SECURITY") ||
    content.includes("CREATE POLICY")
  ) {
    logSuccess("RLS policies found in migration");
  } else {
    logError("RLS policies not found in migration");
  }
}

// Main execution
console.log("🔍 Vault Configuration Verification");
console.log("=".repeat(50));

verifyEdgeFunctions();
verifyBucketName();
verifyEnvVarReferences();
verifyMigration();

// Summary
console.log("\n" + "=".repeat(50));
if (errors.length === 0) {
  console.log("✅ All Vault configuration checks passed!\n");
  process.exit(0);
} else {
  console.log(`\n❌ ${errors.length} error(s) found:\n`);
  errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
  console.log("");
  process.exit(1);
}

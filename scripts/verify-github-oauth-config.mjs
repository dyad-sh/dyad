#!/usr/bin/env node

/**
 * GitHub OAuth Configuration Verification Script
 *
 * This script verifies that the GitHub OAuth configuration is properly set up:
 * 1. Checks that no hardcoded Dyad legacy client ID exists in the codebase
 * 2. Verifies the environment variable pattern is correctly used
 * 3. Ensures scopes are minimal (no unnecessary permissions)
 *
 * This runs as part of CI to prevent accidental OAuth misconfigurations.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// The legacy Dyad client ID that must NOT be used as a fallback
const DYAD_LEGACY_CLIENT_ID = "Ov23liWV2HdC0RBLecWx";

// Expected minimum scopes (anything more is suspicious)
const EXPECTED_MINIMAL_SCOPES = ["read:user", "user:email", "repo"];
const OVERLY_BROAD_SCOPES = ["admin", "delete_repo", "workflow", "write:org"];

// Track errors and warnings
const errors = [];
const warnings = [];

function logSuccess(message) {
  console.log(`✅ ${message}`);
}

function logWarning(message) {
  console.log(`⚠️  ${message}`);
  warnings.push(message);
}

function logError(message) {
  console.log(`❌ ${message}`);
  errors.push(message);
}

/**
 * Check for hardcoded legacy Dyad client ID as a fallback
 */
function checkForLegacyClientId() {
  console.log("\n🔍 Checking for legacy Dyad client ID...\n");

  const handlersPath = path.join(
    ROOT_DIR,
    "src/ipc/handlers/github_handlers.ts",
  );

  if (!fs.existsSync(handlersPath)) {
    logError("github_handlers.ts not found!");
    return;
  }

  const content = fs.readFileSync(handlersPath, "utf-8");

  // Check if the legacy ID is used as a hardcoded fallback (the old pattern)
  // Pattern: process.env.SOMETHING || "Ov23liWV2HdC0RBLecWx"
  const hardcodedFallbackPattern = new RegExp(
    `process\\.env\\.[A-Z_]+\\s*\\|\\|\\s*["']${DYAD_LEGACY_CLIENT_ID}["']`,
    "g",
  );

  if (hardcodedFallbackPattern.test(content)) {
    logError(
      `github_handlers.ts uses legacy Dyad client ID "${DYAD_LEGACY_CLIENT_ID}" as a fallback. ` +
        `This must be replaced with proper environment variable configuration.`,
    );
    return;
  }

  // Verify the legacy ID is defined as a constant for comparison only
  if (!content.includes(`DYAD_LEGACY_CLIENT_ID = "${DYAD_LEGACY_CLIENT_ID}"`)) {
    logWarning(
      "Legacy client ID constant not found. Ensure it's defined for validation purposes.",
    );
  }

  // Verify getGithubClientId function exists and handles validation
  if (!content.includes("function getGithubClientId()")) {
    logError("getGithubClientId() function not found in github_handlers.ts");
    return;
  }

  // Verify the function checks for legacy ID
  if (!content.includes("DYAD_LEGACY_CLIENT_ID")) {
    logWarning(
      "getGithubClientId() may not check for legacy client ID. " +
        "Ensure it rejects the Dyad value.",
    );
  }

  // Verify ABBA_GITHUB_OAUTH_CLIENT_ID is used
  if (!content.includes("ABBA_GITHUB_OAUTH_CLIENT_ID")) {
    logError(
      "ABBA_GITHUB_OAUTH_CLIENT_ID environment variable pattern not found. " +
        "This is the preferred env var for ABBA-branded builds.",
    );
    return;
  }

  logSuccess("Legacy client ID is properly handled (not used as fallback)");
  logSuccess("ABBA_GITHUB_OAUTH_CLIENT_ID pattern is present");
}

/**
 * Check OAuth scopes are minimal
 */
function checkOAuthScopes() {
  console.log("\n🔑 Checking OAuth scopes...\n");

  const handlersPath = path.join(
    ROOT_DIR,
    "src/ipc/handlers/github_handlers.ts",
  );

  if (!fs.existsSync(handlersPath)) {
    return;
  }

  const content = fs.readFileSync(handlersPath, "utf-8");

  // Find GITHUB_SCOPES definition
  const scopesMatch = content.match(/GITHUB_SCOPES\s*=\s*["']([^"']+)["']/);

  if (!scopesMatch) {
    logError("GITHUB_SCOPES constant not found in github_handlers.ts");
    return;
  }

  const scopesString = scopesMatch[1];
  const scopes = scopesString.split(",").map((s) => s.trim());

  console.log(`📋 Configured scopes: ${scopes.join(", ")}`);

  // Check for overly broad scopes
  for (const scope of OVERLY_BROAD_SCOPES) {
    if (scopes.includes(scope)) {
      logWarning(
        `Scope "${scope}" may be overly broad. ` +
          `Ensure it's required for the publish workflow.`,
      );
    }
  }

  // Verify expected minimal scopes are present
  const missingScopes = EXPECTED_MINIMAL_SCOPES.filter(
    (expected) =>
      !scopes.some(
        (s) => s === expected || s.startsWith(expected.split(":")[0] + ":"),
      ),
  );

  if (missingScopes.length > 0) {
    logWarning(
      `Some expected scopes may be missing: ${missingScopes.join(", ")}`,
    );
  }

  // Check for "user" scope which is broader than "read:user"
  if (scopes.includes("user") && !scopes.includes("read:user")) {
    logWarning(
      '"user" scope is broader than needed. Consider using "read:user" instead.',
    );
  }

  logSuccess("OAuth scopes appear reasonable");
}

/**
 * Check .env.example has the new env var documented
 */
function checkEnvExample() {
  console.log("\n📄 Checking .env.example...\n");

  const envExamplePath = path.join(ROOT_DIR, ".env.example");

  if (!fs.existsSync(envExamplePath)) {
    logWarning(".env.example not found");
    return;
  }

  const content = fs.readFileSync(envExamplePath, "utf-8");

  if (!content.includes("ABBA_GITHUB_OAUTH_CLIENT_ID")) {
    logWarning(
      ".env.example doesn't document ABBA_GITHUB_OAUTH_CLIENT_ID. " +
        "Consider adding it for developer documentation.",
    );
  } else {
    logSuccess("ABBA_GITHUB_OAUTH_CLIENT_ID is documented in .env.example");
  }
}

/**
 * Check runtime validation function exists
 */
function checkValidationFunction() {
  console.log("\n🛡️ Checking validation function...\n");

  const handlersPath = path.join(
    ROOT_DIR,
    "src/ipc/handlers/github_handlers.ts",
  );

  if (!fs.existsSync(handlersPath)) {
    return;
  }

  const content = fs.readFileSync(handlersPath, "utf-8");

  if (!content.includes("validateGithubOAuthConfig")) {
    logWarning(
      "validateGithubOAuthConfig function not found. " +
        "Consider adding a validation function for runtime checks.",
    );
    return;
  }

  // Check it's exported
  if (!content.includes("export function validateGithubOAuthConfig")) {
    logWarning("validateGithubOAuthConfig may not be exported");
  } else {
    logSuccess("validateGithubOAuthConfig function is exported");
  }
}

// Main execution
console.log("🔒 GitHub OAuth Configuration Verification");
console.log("=".repeat(50));

checkForLegacyClientId();
checkOAuthScopes();
checkEnvExample();
checkValidationFunction();

// Summary
console.log("\n" + "=".repeat(50));

if (errors.length === 0) {
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warning(s):\n`);
    warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
  }
  console.log("\n✅ GitHub OAuth configuration verification passed!\n");
  process.exit(0);
} else {
  console.log(`\n❌ ${errors.length} error(s) found:\n`);
  errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
  console.log("\nTo fix:");
  console.log("  1. Set ABBA_GITHUB_OAUTH_CLIENT_ID environment variable");
  console.log("  2. Do NOT use hardcoded Dyad client ID as fallback");
  console.log("  3. Ensure OAuth scopes are minimal\n");
  process.exit(1);
}

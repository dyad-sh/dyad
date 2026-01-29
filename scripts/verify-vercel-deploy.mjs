#!/usr/bin/env node

/**
 * Vercel Deploy Integration Verification Script
 *
 * This script verifies that the Vercel Deploy integration is properly set up:
 * 1. Checks that the Vercel Integration panel exists in settings
 * 2. Verifies the deploy entrypoint exists in publish UI
 * 3. Scans for token leakage patterns
 *
 * This runs as part of CI to prevent accidental misconfigurations.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

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
 * Check that Vercel Integration panel exists in settings
 */
function checkVercelIntegrationPanel() {
  console.log("\n🔍 Checking Vercel Integration panel...\n");

  const integrationPath = path.join(
    ROOT_DIR,
    "src/components/VercelIntegration.tsx",
  );

  if (!fs.existsSync(integrationPath)) {
    logError("VercelIntegration.tsx not found!");
    return;
  }

  const content = fs.readFileSync(integrationPath, "utf-8");

  // Check for key UI elements
  const requiredElements = [
    { pattern: "Test Connection", name: "Test Connection button" },
    { pattern: "Copy Diagnostics", name: "Copy Diagnostics button" },
    { pattern: "vercelAccessToken", name: "Token check" },
    { pattern: "handleTestConnection", name: "Test connection handler" },
  ];

  for (const { pattern, name } of requiredElements) {
    if (!content.includes(pattern)) {
      logError(`Missing required element: ${name} (pattern: ${pattern})`);
    } else {
      logSuccess(`Found: ${name}`);
    }
  }
}

/**
 * Check that deploy entrypoint exists in publish UI
 */
function checkPublishPanelDeploy() {
  console.log("\n📦 Checking Publish Panel deploy entrypoint...\n");

  const publishPanelPath = path.join(
    ROOT_DIR,
    "src/components/preview_panel/PublishPanel.tsx",
  );

  if (!fs.existsSync(publishPanelPath)) {
    logError("PublishPanel.tsx not found!");
    return;
  }

  const content = fs.readFileSync(publishPanelPath, "utf-8");

  // Check for deploy button and related elements
  const requiredElements = [
    { pattern: "Deploy to Vercel", name: "Deploy button text" },
    { pattern: "vercel-deploy-button", name: "Deploy button test ID" },
    { pattern: "vercel-direct-deploy", name: "Direct deploy section test ID" },
    { pattern: "deployToVercel", name: "Deploy function call" },
    { pattern: "handleDirectDeploy", name: "Deploy handler function" },
  ];

  for (const { pattern, name } of requiredElements) {
    if (!content.includes(pattern)) {
      logError(`Missing required element: ${name} (pattern: ${pattern})`);
    } else {
      logSuccess(`Found: ${name}`);
    }
  }

  // Verify GitHub is NOT required
  if (content.includes("GitHub Required for Vercel Deployment")) {
    logError(
      "Found old 'GitHub Required for Vercel' message - this should be removed!",
    );
  } else {
    logSuccess("No GitHub requirement blocking Vercel deploy");
  }
}

/**
 * Check for token leakage patterns in handlers
 */
function checkTokenLeakage() {
  console.log("\n🔒 Checking for token leakage patterns...\n");

  const handlersPath = path.join(
    ROOT_DIR,
    "src/ipc/handlers/vercel_handlers.ts",
  );

  if (!fs.existsSync(handlersPath)) {
    logError("vercel_handlers.ts not found!");
    return;
  }

  const content = fs.readFileSync(handlersPath, "utf-8");

  // Patterns that would indicate token leakage
  const dangerousPatterns = [
    {
      pattern: /logger\.(info|log|debug|warn|error)\s*\([^)]*accessToken/gi,
      name: "Logging accessToken directly",
    },
    {
      pattern: /logger\.(info|log|debug|warn|error)\s*\([^)]*token[^)]*\)/gi,
      name: "Logging token in message (potential leak)",
      // Note: This is a broad pattern, might have false positives
      isSoft: true,
    },
    {
      pattern: /console\.(log|info|debug|warn|error)\s*\([^)]*accessToken/gi,
      name: "Console logging accessToken",
    },
  ];

  let foundDangerousPattern = false;

  for (const { pattern, name, isSoft } of dangerousPatterns) {
    const matches = content.match(pattern);
    if (matches && !isSoft) {
      logError(`Found dangerous pattern: ${name}`);
      foundDangerousPattern = true;
    } else if (matches && isSoft) {
      // Check if it's actually dangerous by examining context
      // For now, just warn
      logWarning(
        `Potential issue found: ${name}. Manual review recommended.`,
      );
    }
  }

  if (!foundDangerousPattern) {
    logSuccess("No obvious token leakage patterns found");
  }

  // Check that DO NOT LOG comment exists for sensitive handler
  if (content.includes("DO NOT LOG this handler because tokens are sensitive")) {
    logSuccess("Token handler has security comment");
  } else {
    logWarning(
      "Missing security comment for token handler. Ensure tokens are not logged.",
    );
  }
}

/**
 * Check that IPC types exist
 */
function checkIpcTypes() {
  console.log("\n📝 Checking IPC types...\n");

  const typesPath = path.join(ROOT_DIR, "src/ipc/ipc_types.ts");

  if (!fs.existsSync(typesPath)) {
    logError("ipc_types.ts not found!");
    return;
  }

  const content = fs.readFileSync(typesPath, "utf-8");

  const requiredTypes = [
    "VercelTestConnectionResult",
    "VercelDeployParams",
    "VercelDeployResult",
  ];

  for (const typeName of requiredTypes) {
    if (!content.includes(typeName)) {
      logError(`Missing required type: ${typeName}`);
    } else {
      logSuccess(`Found type: ${typeName}`);
    }
  }
}

/**
 * Check that documentation exists
 */
function checkDocumentation() {
  console.log("\n📚 Checking documentation...\n");

  const docPath = path.join(ROOT_DIR, "docs/VERCEL_DEPLOY.md");

  if (!fs.existsSync(docPath)) {
    logWarning(
      "VERCEL_DEPLOY.md documentation not found. Consider adding it.",
    );
    return;
  }

  const content = fs.readFileSync(docPath, "utf-8");

  const requiredSections = [
    { pattern: "access token", name: "Token creation instructions" },
    { pattern: "Settings", name: "Settings navigation" },
    { pattern: "Troubleshoot", name: "Troubleshooting section" },
  ];

  for (const { pattern, name } of requiredSections) {
    if (!content.toLowerCase().includes(pattern.toLowerCase())) {
      logWarning(`Documentation may be missing: ${name}`);
    } else {
      logSuccess(`Documentation includes: ${name}`);
    }
  }
}

// Main execution
console.log("🚀 Vercel Deploy Integration Verification");
console.log("=".repeat(50));

checkVercelIntegrationPanel();
checkPublishPanelDeploy();
checkTokenLeakage();
checkIpcTypes();
checkDocumentation();

// Summary
console.log("\n" + "=".repeat(50));

if (errors.length === 0) {
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warning(s):\n`);
    warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
  }
  console.log("\n✅ Vercel Deploy integration verification passed!\n");
  process.exit(0);
} else {
  console.log(`\n❌ ${errors.length} error(s) found:\n`);
  errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
  console.log("\nTo fix:");
  console.log("  1. Ensure all required UI elements are present");
  console.log("  2. Remove any GitHub requirements from Vercel deploy");
  console.log("  3. Ensure tokens are never logged\n");
  process.exit(1);
}

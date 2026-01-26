#!/usr/bin/env node

/**
 * CSP Connect-Src Verification Script
 *
 * This script verifies that if any Content Security Policy is defined,
 * it includes the required Supabase domains for Vault connectivity.
 *
 * Required domains:
 * - *.supabase.co (for API calls)
 * - *.supabase.in (for some regional deployments)
 *
 * This runs as part of CI to prevent accidental CSP regressions that
 * would block Vault network calls in packaged builds.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Required domains for Vault connectivity
const REQUIRED_DOMAINS = ["*.supabase.co", "*.supabase.in"];

// Files that might contain CSP configuration
const CSP_CONFIG_LOCATIONS = [
  "index.html",
  "src/main.ts",
  "vite.renderer.config.mts",
  "forge.config.ts",
];

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
 * Check if content contains CSP configuration
 */
function hasCSPConfig(content) {
  const cspPatterns = [
    /Content-Security-Policy/i,
    /connect-src/i,
    /default-src/i,
    /webRequest\.onHeadersReceived/i,
    /session\.webRequest/i,
  ];

  return cspPatterns.some((pattern) => pattern.test(content));
}

/**
 * Check if CSP allows required domains
 */
function checkCSPDomains(content, filePath) {
  // Look for connect-src directive
  const connectSrcMatch = content.match(/connect-src\s+([^;]+)/i);

  if (!connectSrcMatch) {
    // If there's CSP but no connect-src, that's potentially problematic
    if (content.match(/Content-Security-Policy/i)) {
      logWarning(
        `${filePath}: Has CSP but no explicit connect-src directive. ` +
          `Ensure it doesn't block Supabase endpoints.`,
      );
    }
    return;
  }

  const connectSrcValue = connectSrcMatch[1];

  // Check for 'self' only (too restrictive)
  if (
    connectSrcValue.trim() === "'self'" ||
    connectSrcValue.match(/^'self'\s*$/)
  ) {
    logError(
      `${filePath}: connect-src is set to 'self' only, which blocks Supabase. ` +
        `Add: ${REQUIRED_DOMAINS.join(" ")}`,
    );
    return;
  }

  // Check that required domains are present
  for (const domain of REQUIRED_DOMAINS) {
    // Convert wildcard to regex pattern
    const domainPattern = domain.replace(/\*/g, "[^\\s]+");
    const regex = new RegExp(domainPattern.replace(/\./g, "\\."), "i");

    if (!regex.test(connectSrcValue) && !connectSrcValue.includes(domain)) {
      // Check for https://*.supabase.co format
      const httpsPattern = `https://${domain}`;
      if (!connectSrcValue.includes(httpsPattern)) {
        logError(
          `${filePath}: connect-src missing required domain: ${domain}. ` +
            `Current value: ${connectSrcValue.trim()}`,
        );
      }
    }
  }
}

/**
 * Scan files for CSP configuration
 */
function scanForCSP() {
  console.log("\n🔍 Scanning for CSP configuration...\n");

  let foundCSP = false;

  for (const relativePath of CSP_CONFIG_LOCATIONS) {
    const filePath = path.join(ROOT_DIR, relativePath);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf-8");

    if (hasCSPConfig(content)) {
      foundCSP = true;
      console.log(`📄 Found potential CSP config in: ${relativePath}`);
      checkCSPDomains(content, relativePath);
    }
  }

  // Also scan src directory for any webRequest handlers
  const srcDir = path.join(ROOT_DIR, "src");
  scanDirectory(srcDir);

  return foundCSP;
}

/**
 * Recursively scan directory for CSP configuration
 */
function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and test directories
      if (entry.name !== "node_modules" && !entry.name.startsWith("__")) {
        scanDirectory(fullPath);
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      const relativePath = path.relative(ROOT_DIR, fullPath);

      // Check for webRequest CSP modifications
      if (
        content.includes("webRequest.onHeadersReceived") &&
        content.includes("Content-Security-Policy")
      ) {
        console.log(`📄 Found CSP header modification in: ${relativePath}`);
        checkCSPDomains(content, relativePath);
      }
    }
  }
}

/**
 * Verify Electron main process fetch capabilities
 */
function verifyFetchCapabilities() {
  console.log("\n🌐 Verifying fetch configuration...\n");

  // Check that we're using native fetch (Node.js 18+)
  const mainTsPath = path.join(ROOT_DIR, "src", "main.ts");
  if (fs.existsSync(mainTsPath)) {
    const content = fs.readFileSync(mainTsPath, "utf-8");

    // Check for any custom fetch polyfills that might cause issues
    if (content.includes("node-fetch") || content.includes("cross-fetch")) {
      logWarning(
        "main.ts may use fetch polyfill. Native fetch in Node.js 18+ is recommended.",
      );
    }
  }

  // Check forge.config.ts for any nodeIntegration or contextIsolation issues
  const forgeConfigPath = path.join(ROOT_DIR, "forge.config.ts");
  if (fs.existsSync(forgeConfigPath)) {
    const content = fs.readFileSync(forgeConfigPath, "utf-8");

    // These should be set correctly for security
    if (content.includes("nodeIntegration: true")) {
      logWarning(
        "forge.config.ts has nodeIntegration: true. This is not recommended.",
      );
    }
  }

  logSuccess("Fetch configuration looks correct");
}

/**
 * Verify vault client network calls
 */
function verifyVaultClient() {
  console.log("\n📦 Verifying Vault client configuration...\n");

  const vaultClientPath = path.join(
    ROOT_DIR,
    "src",
    "vault",
    "vault_client.ts",
  );

  if (!fs.existsSync(vaultClientPath)) {
    logError("vault_client.ts not found");
    return;
  }

  const content = fs.readFileSync(vaultClientPath, "utf-8");

  // Verify it uses native fetch
  if (content.includes("fetch(")) {
    logSuccess("Vault client uses native fetch");
  } else {
    logWarning("Vault client may not use native fetch");
  }

  // Check for proper error handling
  if (content.includes("response.ok") || content.includes("!response.ok")) {
    logSuccess("Vault client has response status checking");
  } else {
    logWarning("Vault client may not properly check response status");
  }
}

// Main execution
console.log("🔒 CSP Connect-Src Verification");
console.log("=".repeat(50));

const foundCSP = scanForCSP();
verifyFetchCapabilities();
verifyVaultClient();

// Summary
console.log("\n" + "=".repeat(50));

if (!foundCSP) {
  logSuccess(
    "No explicit CSP configuration found. Electron defaults allow all connections.",
  );
}

if (errors.length === 0) {
  if (warnings.length > 0) {
    console.log(`\n⚠️  ${warnings.length} warning(s):\n`);
    warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
  }
  console.log("\n✅ CSP verification passed!\n");
  process.exit(0);
} else {
  console.log(`\n❌ ${errors.length} error(s) found:\n`);
  errors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
  console.log("\nTo fix: Ensure CSP connect-src includes:");
  console.log(
    "  connect-src 'self' https://*.supabase.co https://*.supabase.in\n",
  );
  process.exit(1);
}

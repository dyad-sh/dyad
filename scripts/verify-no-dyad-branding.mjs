#!/usr/bin/env node
/**
 * verify-no-dyad-branding.mjs
 *
 * CI guardrail to prevent reintroduction of Dyad branding in config, docs, and UI text.
 *
 * This script scans specific files/patterns for forbidden Dyad branding terms.
 * It DOES NOT scan:
 * - Functional code (dyad_tag_parser.ts, response_processor.ts, etc.)
 * - Test fixtures/snapshots (e2e-tests/)
 * - NPM packages (@dyad-sh/*)
 * - Worker files (worker/dyad-*.js)
 *
 * These are intentionally preserved as they are functional, not branding.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

let hasErrors = false;

function error(message, file, line) {
  console.error(`❌ ${file}:${line || "?"}: ${message}`);
  hasErrors = true;
}

function success(message) {
  console.log(`✅ ${message}`);
}

console.log("🔍 Scanning for forbidden Dyad branding...\n");

// Forbidden patterns - case insensitive
const FORBIDDEN_PATTERNS = [
  // URLs/repos (should use abba-ai)
  /github\.com\/yosiwizman\/dyad(?![-a-z])/gi, // dyad repo, not dyad-something
  /github\.com\/dyad-sh\/dyad/gi,
  /dyad\.sh/gi,
  /dyad\.dev/gi,

  // Branding text (not functional tags)
  /\bDyad AI\b/gi,
  /\bDyad app\b/gi,
  /\bthe Dyad\b/gi,
  /\bin Dyad\b/gi,
  /\bfor Dyad\b/gi,
  /\bwith Dyad\b/gi,
  /\busing Dyad\b/gi,
];

// Allowlist patterns (substrings that should be ignored)
const ALLOWLIST = [
  // Functional tags - these are XML-like protocol tags, not branding
  "<dyad-",
  "dyad-write",
  "dyad-delete",
  "dyad-rename",
  "dyad-command",
  "dyad-chat-summary",
  "dyad-execute-sql",
  "dyad-search-replace",
  "dyad-add-dependency",
  "dyad-add-integration",
  "dyad-think",
  "dyad-status",

  // Functional code references
  "dyad_tag_parser",
  "DyadMarkdownParser",
  "Dyad*.tsx", // Component file references in docs
  "getDyadAppsBaseDirectory", // Legacy (should be renamed but acceptable in comments)
  "getDyadAppPath",

  // Attribution (intentionally preserved)
  "forked from Dyad",
  "forked from [Dyad]",

  // NPM package names (published, cannot rename)
  "@dyad-sh/",

  // External dependencies
  "dyad-sh/supabase-management-js",

  // File references in docs/comments
  "dyad-sw.js",
  "dyad-shim.js",
  "dyad-logs.js",

  // Environment variable names (external service)
  "DYAD_ENGINE_URL",

  // Audit report itself
  "BRAND_AUDIT.md",
];

// Files to scan (config, docs, UI-facing)
const SCAN_PATTERNS = [
  "package.json",
  "forge.config.ts",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CLA.md",
  "docs/**/*.md",
  ".github/**/*.yml",
  ".github/**/*.md",
  "src/main.ts",
  "src/components/**/*.tsx",
  "src/prompts/*.ts",
];

// Files to explicitly exclude
const EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/e2e-tests/**",
  "**/packages/**",
  "**/worker/**",
  "**/dist/**",
  "**/out/**",
  "**/__tests__/**",
  "**/snapshots/**",
  "**/fixtures/**",
  "docs/BRAND_AUDIT.md", // This file documents Dyad references
];

function isAllowlisted(line) {
  return ALLOWLIST.some((allowed) => line.includes(allowed));
}

async function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const relativePath = path.relative(rootDir, filePath);
  let fileHasErrors = false;

  lines.forEach((line, index) => {
    // Skip allowlisted lines
    if (isAllowlisted(line)) {
      return;
    }

    for (const pattern of FORBIDDEN_PATTERNS) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (match) {
        error(`Found forbidden term: "${match[0]}"`, relativePath, index + 1);
        fileHasErrors = true;
      }
    }
  });

  return fileHasErrors;
}

async function main() {
  let filesScanned = 0;
  let filesWithErrors = 0;

  for (const pattern of SCAN_PATTERNS) {
    const files = await glob(pattern, {
      cwd: rootDir,
      ignore: EXCLUDE_PATTERNS,
      absolute: true,
      nodir: true,
    });

    for (const file of files) {
      if (!fs.existsSync(file)) continue;

      filesScanned++;
      const hasFileErrors = await scanFile(file);
      if (hasFileErrors) {
        filesWithErrors++;
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Scanned ${filesScanned} files`);

  if (hasErrors) {
    console.error(
      `\n❌ Found forbidden Dyad branding in ${filesWithErrors} file(s).`,
    );
    console.error(
      "\nIf these are intentional (e.g., attribution), add to ALLOWLIST.",
    );
    console.error("If functional code, add file pattern to EXCLUDE_PATTERNS.");
    process.exit(1);
  } else {
    success(`No forbidden Dyad branding found!`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

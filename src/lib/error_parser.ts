/**
 * Unified error parsing engine for JoyCreate.
 *
 * Parses raw output from TypeScript, Vite/webpack, runtime, dependency,
 * and lint sources into structured errors with categories and fix strategies.
 */

import type {
  ErrorCategory,
  ErrorSource,
  FixStrategy,
  StructuredError,
} from "@/types/error_types";
import type { ProblemReport } from "../../shared/tsc_types";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse raw command/log output into structured errors.
 */
export function parseErrors(
  rawOutput: string,
  source: ErrorSource,
): StructuredError[] {
  switch (source) {
    case "typescript":
      return parseTypescriptErrors(rawOutput);
    case "build":
      return parseBuildErrors(rawOutput);
    case "runtime":
      return parseRuntimeErrors(rawOutput);
    case "dependency":
      return parseDependencyErrors(rawOutput);
    case "lint":
      return parseLintErrors(rawOutput);
    default:
      return [];
  }
}

/**
 * Convert a ProblemReport (from generateProblemReport) into StructuredErrors.
 */
export function problemReportToStructuredErrors(
  report: ProblemReport,
): StructuredError[] {
  return report.problems.map((p) => {
    const error: StructuredError = {
      source: "typescript",
      category: categorizeTsErrorCode(p.code),
      file: p.file,
      line: p.line,
      column: p.column,
      code: p.code,
      message: p.message,
      snippet: p.snippet,
      rawText: `${p.file}:${p.line}:${p.column} - TS${p.code}: ${p.message}`,
    };
    error.suggestedFix = suggestFixStrategy(error);
    return error;
  });
}

/**
 * Categorize a single structured error.
 */
export function categorizeError(error: StructuredError): ErrorCategory {
  return error.category;
}

/**
 * Suggest how the agent should approach fixing this error.
 */
export function suggestFixStrategy(error: StructuredError): FixStrategy {
  switch (error.category) {
    case "missing_import":
      return "add_import";
    case "missing_module":
      return error.packageName ? "install_dep" : "add_import";
    case "dependency":
      return "install_dep";
    case "type":
      return "fix_type";
    case "syntax":
      return "fix_syntax";
    case "config":
      return "config_change";
    case "lint":
      if (error.message.includes("unused")) return "remove_unused";
      return "refactor";
    case "runtime":
      return "refactor";
    default:
      return "manual_review";
  }
}

/**
 * Format structured errors into a concise prompt suitable for the agent.
 */
export function formatErrorsForAgent(errors: StructuredError[]): string {
  if (errors.length === 0) return "No errors detected.";

  const grouped = new Map<ErrorCategory, StructuredError[]>();
  for (const err of errors) {
    const list = grouped.get(err.category) ?? [];
    list.push(err);
    grouped.set(err.category, list);
  }

  let prompt = `Fix these ${errors.length} error${errors.length === 1 ? "" : "s"}:\n\n`;

  for (const [category, errs] of grouped) {
    prompt += `### ${category} (${errs.length})\n`;
    for (const err of errs) {
      const loc = err.file
        ? `${err.file}${err.line ? `:${err.line}` : ""}`
        : "(unknown file)";
      const code = err.code ? ` [${err.code}]` : "";
      prompt += `- ${loc}${code}: ${err.message}`;
      if (err.suggestedFix) prompt += ` → strategy: ${err.suggestedFix}`;
      prompt += "\n";
      if (err.snippet) {
        prompt += `  \`\`\`\n  ${err.snippet}\n  \`\`\`\n`;
      }
    }
    prompt += "\n";
  }

  prompt += "Fix all errors. Use the suggested strategies where applicable.";
  return prompt;
}

// ---------------------------------------------------------------------------
// TypeScript error parser
// ---------------------------------------------------------------------------

// Matches: src/App.tsx(12,5): error TS2307: Cannot find module ...
// Also:    src/App.tsx:12:5 - error TS2307: Cannot find module ...
const TS_ERROR_RE =
  /^(.+?)(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*[-:]\s*error\s+TS(\d+):\s*(.+)$/;

function parseTypescriptErrors(raw: string): StructuredError[] {
  const errors: StructuredError[] = [];
  const lines = raw.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(TS_ERROR_RE);
    if (!match) continue;

    const file = match[1];
    const lineNum = Number.parseInt(match[2] ?? match[4], 10);
    const col = Number.parseInt(match[3] ?? match[5], 10);
    const code = Number.parseInt(match[6], 10);
    const message = match[7];

    // Grab snippet: next lines until blank or next error
    let snippet = "";
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const next = lines[j];
      if (!next.trim() || TS_ERROR_RE.test(next.trim())) break;
      snippet += (snippet ? "\n" : "") + next;
    }

    const category = categorizeTsErrorCode(code);
    const error: StructuredError = {
      source: "typescript",
      category,
      file,
      line: lineNum,
      column: col,
      code,
      message,
      snippet: snippet || undefined,
      rawText: line,
    };
    error.suggestedFix = suggestFixStrategy(error);

    if (category === "missing_module") {
      error.packageName = extractPackageName(message);
    }

    errors.push(error);
  }

  return errors;
}

function categorizeTsErrorCode(code: number): ErrorCategory {
  // 1xxx = syntax
  if (code >= 1000 && code < 2000) return "syntax";
  // Common missing-import/module codes
  if (code === 2307) return "missing_module"; // Cannot find module
  if (code === 2304) return "missing_import"; // Cannot find name
  if (code === 2305) return "missing_import"; // Module has no exported member
  if (code === 2614) return "missing_import"; // Module has no default export
  // 2xxx = type errors generally
  if (code >= 2000 && code < 3000) return "type";
  // 5xxx, 6xxx = config
  if (code >= 5000 && code < 7000) return "config";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Vite / webpack build error parser
// ---------------------------------------------------------------------------

// [vite] Internal server error: ...
const VITE_ERROR_RE = /\[vite\]\s*(?:Internal server error:\s*)?(.+)/i;
// ERROR in ./src/App.tsx 12:5
const WEBPACK_ERROR_RE = /ERROR\s+in\s+(.+?)(?:\s+(\d+):(\d+))?$/;
// Module not found: Error: Can't resolve 'xyz'
const MODULE_NOT_FOUND_RE =
  /Module not found:\s*(?:Error:\s*)?Can't resolve\s+'([^']+)'/;
// [vite] Pre-transform error: Failed to resolve import "xyz" from "src/App.tsx"
const VITE_RESOLVE_RE =
  /Failed to resolve import\s+"([^"]+)"\s+from\s+"([^"]+)"/;

function parseBuildErrors(raw: string): StructuredError[] {
  const errors: StructuredError[] = [];
  const lines = raw.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Module not found (webpack or Vite)
    const moduleMatch = line.match(MODULE_NOT_FOUND_RE);
    if (moduleMatch) {
      const pkg = moduleMatch[1];
      errors.push({
        source: "build",
        category: "missing_module",
        message: `Cannot resolve module '${pkg}'`,
        rawText: line,
        packageName: pkg.startsWith(".") ? undefined : extractPackageName(pkg),
        suggestedFix: pkg.startsWith(".") ? "add_import" : "install_dep",
      });
      continue;
    }

    // Vite resolve error
    const viteResolveMatch = line.match(VITE_RESOLVE_RE);
    if (viteResolveMatch) {
      const pkg = viteResolveMatch[1];
      const fromFile = viteResolveMatch[2];
      errors.push({
        source: "build",
        category: "missing_module",
        file: fromFile,
        message: `Cannot resolve import '${pkg}'`,
        rawText: line,
        packageName: pkg.startsWith(".") ? undefined : extractPackageName(pkg),
        suggestedFix: pkg.startsWith(".") ? "add_import" : "install_dep",
      });
      continue;
    }

    // Vite general error
    const viteMatch = line.match(VITE_ERROR_RE);
    if (viteMatch) {
      errors.push({
        source: "build",
        category: "unknown",
        message: viteMatch[1],
        rawText: line,
        suggestedFix: "manual_review",
      });
      continue;
    }

    // Webpack error
    const wpMatch = line.match(WEBPACK_ERROR_RE);
    if (wpMatch) {
      errors.push({
        source: "build",
        category: "unknown",
        file: wpMatch[1],
        line: wpMatch[2] ? Number.parseInt(wpMatch[2], 10) : undefined,
        column: wpMatch[3] ? Number.parseInt(wpMatch[3], 10) : undefined,
        message: line,
        rawText: line,
        suggestedFix: "manual_review",
      });
      continue;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Runtime error parser (from preview iframe)
// ---------------------------------------------------------------------------

// TypeError: Cannot read properties of undefined (reading 'map')
const RUNTIME_ERROR_RE =
  /^(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|Error):\s*(.+)/;
// at Component (src/App.tsx:12:5)
const STACK_FRAME_RE = /at\s+(?:[\w.]+\s+)?\(?([\w/.@-]+):(\d+):(\d+)\)?/;

function parseRuntimeErrors(raw: string): StructuredError[] {
  const errors: StructuredError[] = [];
  const lines = raw.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(RUNTIME_ERROR_RE);
    if (!match) continue;

    const errorType = match[1];
    const message = match[2];

    // Look for stack frames
    let file: string | undefined;
    let lineNum: number | undefined;
    let col: number | undefined;
    let stack = "";

    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const stackLine = lines[j].trim();
      if (!stackLine.startsWith("at ") && !stackLine.includes("(")) break;
      stack += (stack ? "\n" : "") + stackLine;
      if (!file) {
        const frameMatch = stackLine.match(STACK_FRAME_RE);
        if (frameMatch) {
          file = frameMatch[1];
          lineNum = Number.parseInt(frameMatch[2], 10);
          col = Number.parseInt(frameMatch[3], 10);
        }
      }
    }

    const category: ErrorCategory =
      errorType === "ReferenceError"
        ? "missing_import"
        : errorType === "SyntaxError"
          ? "syntax"
          : "runtime";

    const error: StructuredError = {
      source: "runtime",
      category,
      file,
      line: lineNum,
      column: col,
      message: `${errorType}: ${message}`,
      snippet: stack || undefined,
      rawText: line,
    };
    error.suggestedFix = suggestFixStrategy(error);
    errors.push(error);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Dependency error parser (npm install output)
// ---------------------------------------------------------------------------

// npm ERR! code ERESOLVE
const NPM_ERR_RE = /npm ERR!\s*(?:code\s+)?(\w+)/;
// Could not resolve dependency: peer ... requires ...
const PEER_DEP_RE =
  /(?:peer|optional)\s+(?:dep(?:endency)?)\s+.*?(\S+@\S+)/i;
// npm ERR! notarget No matching version found for xyz@^1.0.0
const NOT_FOUND_RE =
  /No matching version found for\s+(\S+)/;
// Cannot find module 'xyz'
const CANNOT_FIND_MODULE_RE = /Cannot find module\s+'([^']+)'/;

function parseDependencyErrors(raw: string): StructuredError[] {
  const errors: StructuredError[] = [];
  const lines = raw.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const notFoundMatch = line.match(NOT_FOUND_RE);
    if (notFoundMatch) {
      errors.push({
        source: "dependency",
        category: "dependency",
        message: `Package not found: ${notFoundMatch[1]}`,
        rawText: line,
        packageName: extractPackageName(notFoundMatch[1]),
        suggestedFix: "install_dep",
      });
      continue;
    }

    const cannotFindMatch = line.match(CANNOT_FIND_MODULE_RE);
    if (cannotFindMatch) {
      errors.push({
        source: "dependency",
        category: "missing_module",
        message: `Missing module: ${cannotFindMatch[1]}`,
        rawText: line,
        packageName: extractPackageName(cannotFindMatch[1]),
        suggestedFix: "install_dep",
      });
      continue;
    }

    const peerMatch = line.match(PEER_DEP_RE);
    if (peerMatch) {
      errors.push({
        source: "dependency",
        category: "dependency",
        message: `Peer dependency conflict: ${peerMatch[1]}`,
        rawText: line,
        packageName: extractPackageName(peerMatch[1]),
        suggestedFix: "install_dep",
      });
      continue;
    }

    const npmErrMatch = line.match(NPM_ERR_RE);
    if (npmErrMatch && npmErrMatch[1] === "ERESOLVE") {
      errors.push({
        source: "dependency",
        category: "dependency",
        message: "Dependency resolution conflict (ERESOLVE)",
        rawText: line,
        suggestedFix: "install_dep",
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// ESLint error parser
// ---------------------------------------------------------------------------

// /full/path/to/file.tsx: line 12, col 5, Error - no-unused-vars ...
// or compact format: /path/file.tsx:12:5: error rule-name message
const ESLINT_COMPACT_RE = /^(.+?):(\d+):(\d+):\s*(error|warning)\s+(.+)/;
const ESLINT_STYLISH_RE =
  /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}([\w/@-]+)\s*$/;

function parseLintErrors(raw: string): StructuredError[] {
  const errors: StructuredError[] = [];
  const lines = raw.split("\n");
  let currentFile = "";

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Compact format
    const compactMatch = line.match(ESLINT_COMPACT_RE);
    if (compactMatch) {
      errors.push({
        source: "lint",
        category: "lint",
        file: compactMatch[1],
        line: Number.parseInt(compactMatch[2], 10),
        column: Number.parseInt(compactMatch[3], 10),
        code: compactMatch[4],
        message: compactMatch[5],
        rawText: line,
        suggestedFix: compactMatch[5].includes("unused")
          ? "remove_unused"
          : "refactor",
      });
      continue;
    }

    // Stylish format: file path on its own line
    if (line && !line.startsWith(" ") && !line.includes("error") && !line.includes("warning")) {
      currentFile = line.trim();
      continue;
    }

    const stylishMatch = line.match(ESLINT_STYLISH_RE);
    if (stylishMatch && currentFile) {
      errors.push({
        source: "lint",
        category: "lint",
        file: currentFile,
        line: Number.parseInt(stylishMatch[1], 10),
        column: Number.parseInt(stylishMatch[2], 10),
        code: stylishMatch[5],
        message: stylishMatch[4],
        rawText: line,
        suggestedFix: stylishMatch[4].includes("unused")
          ? "remove_unused"
          : "refactor",
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the npm package name from a module specifier or version string.
 * Handles scoped packages: `@scope/pkg/sub` → `@scope/pkg`
 * Handles version suffixes: `react@^18.0.0` → `react`
 */
function extractPackageName(
  specifier: string,
): string | undefined {
  if (!specifier) return undefined;
  // Strip quotes
  const cleaned = specifier.replace(/['"]/g, "").trim();
  // Relative import — not a package
  if (cleaned.startsWith(".") || cleaned.startsWith("/")) return undefined;
  // Remove version suffix
  const noVersion = cleaned.split("@").length > 2
    ? `@${cleaned.split("@")[1]}`
    : cleaned.split("@")[0];

  // Scoped: @scope/pkg/sub → @scope/pkg
  if (noVersion.startsWith("@")) {
    const parts = noVersion.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : noVersion;
  }
  // Unscoped: pkg/sub → pkg
  return noVersion.split("/")[0] || undefined;
}

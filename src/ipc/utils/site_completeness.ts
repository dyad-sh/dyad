/**
 * Site Completeness Checker
 *
 * Scans generated app files for signs of incomplete implementation:
 * - Unresolved imports (referencing files that don't exist)
 * - TODO/placeholder comments left in code
 * - Incomplete components (empty returns, stub functions)
 * - Missing route pages
 *
 * Returns issues found and a follow-up prompt to complete the site.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log";

const logger = log.scope("site_completeness");

export interface CompletenessIssue {
  file: string;
  line: number;
  type: "unresolved-import" | "todo-placeholder" | "incomplete-component" | "missing-route-page";
  message: string;
}

export interface CompletenessReport {
  isComplete: boolean;
  issues: CompletenessIssue[];
  followUpPrompt: string | null;
}

const PLACEHOLDER_PATTERNS = [
  /\/\/\s*TODO/i,
  /\/\*\s*TODO/i,
  /\/\/\s*FIXME/i,
  /\/\/\s*HACK/i,
  /\/\/\s*placeholder/i,
  /\/\/\s*implement\s+(this|me|here)/i,
  /throw\s+new\s+Error\s*\(\s*['"`]Not\s+implemented/i,
  /\{\s*\/\*\s*placeholder\s*\*\/\s*\}/i,
  /return\s+null\s*;\s*\/\/\s*todo/i,
  /console\.log\(['"`]TODO/i,
];

const INCOMPLETE_COMPONENT_PATTERNS = [
  /return\s*\(\s*<>\s*<\/>\s*\)/,                     // return (<></>)
  /return\s+null\s*;?\s*$/m,                           // return null at end
  /return\s*\(\s*<div>\s*<\/div>\s*\)/,                // return (<div></div>) empty
  /export\s+default\s+function\s+\w+\s*\([^)]*\)\s*\{\s*\}/, // empty function body
  /=>\s*\{\s*\}\s*;?\s*$/m,                            // arrow fn with empty body
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte"];

/**
 * Recursively collect source files from the app directory.
 */
function collectSourceFiles(dir: string, files: string[] = []): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "build") {
          continue;
        }
        collectSourceFiles(fullPath, files);
      } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist yet
  }
  return files;
}

/**
 * Check for unresolved relative imports in a file.
 */
function checkUnresolvedImports(
  filePath: string,
  content: string,
  appPath: string,
  allFilePaths: Set<string>,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const lines = content.split("\n");

  // Match import/require statements with relative paths
  const importRegex = /(?:import\s.*?from\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    importRegex.lastIndex = 0;

    while ((match = importRegex.exec(line)) !== null) {
      const importPath = match[1];
      const dir = path.dirname(filePath);
      const resolvedBase = path.resolve(dir, importPath);

      // Check common extensions
      const possiblePaths = [
        resolvedBase,
        resolvedBase + ".ts",
        resolvedBase + ".tsx",
        resolvedBase + ".js",
        resolvedBase + ".jsx",
        path.join(resolvedBase, "index.ts"),
        path.join(resolvedBase, "index.tsx"),
        path.join(resolvedBase, "index.js"),
        path.join(resolvedBase, "index.jsx"),
      ];

      const exists = possiblePaths.some(
        (p) => allFilePaths.has(p) || fs.existsSync(p),
      );

      if (!exists) {
        const relFile = path.relative(appPath, filePath).replace(/\\/g, "/");
        issues.push({
          file: relFile,
          line: i + 1,
          type: "unresolved-import",
          message: `Unresolved import "${importPath}" — referenced file does not exist`,
        });
      }
    }
  }

  return issues;
}

/**
 * Check for TODO/placeholder patterns in a file.
 */
function checkPlaceholders(
  filePath: string,
  content: string,
  appPath: string,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(line)) {
        const relFile = path.relative(appPath, filePath).replace(/\\/g, "/");
        issues.push({
          file: relFile,
          line: i + 1,
          type: "todo-placeholder",
          message: `Placeholder/TODO found: "${line.trim().substring(0, 80)}"`,
        });
        break; // One issue per line is enough
      }
    }
  }

  return issues;
}

/**
 * Check for incomplete/stub components.
 */
function checkIncompleteComponents(
  filePath: string,
  content: string,
  appPath: string,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];

  for (const pattern of INCOMPLETE_COMPONENT_PATTERNS) {
    if (pattern.test(content)) {
      const relFile = path.relative(appPath, filePath).replace(/\\/g, "/");
      issues.push({
        file: relFile,
        line: 1,
        type: "incomplete-component",
        message: `Component appears to have an empty or stub implementation`,
      });
      break;
    }
  }

  return issues;
}

/**
 * Check for routes that reference pages that don't exist.
 */
function checkMissingRoutePages(
  appPath: string,
  allFilePaths: Set<string>,
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];

  // Check App.tsx or main router file for route definitions
  const routerFiles = [
    path.join(appPath, "src", "App.tsx"),
    path.join(appPath, "src", "App.jsx"),
    path.join(appPath, "src", "router.tsx"),
    path.join(appPath, "src", "routes.tsx"),
  ];

  for (const routerFile of routerFiles) {
    if (!fs.existsSync(routerFile)) continue;

    const content = fs.readFileSync(routerFile, "utf-8");
    // Match lazy imports or regular page imports
    const lazyImportRegex = /lazy\s*\(\s*\(\)\s*=>\s*import\s*\(\s*['"](\.[^'"]+)['"]\s*\)\s*\)/g;
    const importRegex = /import\s+\w+\s+from\s+['"](\.[^'"]+)['"]/g;

    const checkImport = (regex: RegExp) => {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const importPath = match[1];
        const resolvedBase = path.resolve(path.dirname(routerFile), importPath);
        const possiblePaths = [
          resolvedBase,
          resolvedBase + ".tsx",
          resolvedBase + ".ts",
          resolvedBase + ".jsx",
          resolvedBase + ".js",
        ];
        const exists = possiblePaths.some(
          (p) => allFilePaths.has(p) || fs.existsSync(p),
        );
        if (!exists) {
          const relFile = path.relative(appPath, routerFile).replace(/\\/g, "/");
          issues.push({
            file: relFile,
            line: 1,
            type: "missing-route-page",
            message: `Route references page "${importPath}" which does not exist`,
          });
        }
      }
    };

    checkImport(lazyImportRegex);
    checkImport(importRegex);
  }

  return issues;
}

/**
 * Build a follow-up prompt from the completeness issues.
 */
function buildFollowUpPrompt(issues: CompletenessIssue[]): string {
  const grouped = {
    "unresolved-import": [] as CompletenessIssue[],
    "todo-placeholder": [] as CompletenessIssue[],
    "incomplete-component": [] as CompletenessIssue[],
    "missing-route-page": [] as CompletenessIssue[],
  };

  for (const issue of issues) {
    grouped[issue.type].push(issue);
  }

  const parts: string[] = [
    "The site is not fully complete. Please finish implementing the following:\n",
  ];

  if (grouped["missing-route-page"].length > 0) {
    parts.push("## Missing Pages");
    for (const issue of grouped["missing-route-page"]) {
      parts.push(`- ${issue.message} (in ${issue.file})`);
    }
    parts.push("");
  }

  if (grouped["unresolved-import"].length > 0) {
    parts.push("## Missing Files (Unresolved Imports)");
    // Deduplicate by message
    const seen = new Set<string>();
    for (const issue of grouped["unresolved-import"]) {
      const key = `${issue.file}:${issue.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        parts.push(`- In \`${issue.file}\`: ${issue.message}`);
      }
    }
    parts.push("");
  }

  if (grouped["incomplete-component"].length > 0) {
    parts.push("## Incomplete Components");
    for (const issue of grouped["incomplete-component"]) {
      parts.push(`- \`${issue.file}\`: ${issue.message}`);
    }
    parts.push("");
  }

  if (grouped["todo-placeholder"].length > 0) {
    parts.push("## TODOs / Placeholders to Complete");
    // Only list unique files
    const uniqueFiles = new Set(grouped["todo-placeholder"].map((i) => i.file));
    for (const file of uniqueFiles) {
      const fileIssues = grouped["todo-placeholder"].filter((i) => i.file === file);
      parts.push(`- \`${file}\`: ${fileIssues.length} placeholder(s) to implement`);
    }
    parts.push("");
  }

  parts.push(
    "Please create all missing files with FULL implementations (no placeholders or TODOs). " +
    "Replace all stub/empty components with complete working code. " +
    "Make sure every import resolves to an existing file.",
  );

  return parts.join("\n");
}

/**
 * Run a full completeness check on the app.
 */
export async function checkSiteCompleteness(appPath: string): Promise<CompletenessReport> {
  logger.info(`Running completeness check on ${appPath}`);

  const sourceFiles = collectSourceFiles(path.join(appPath, "src"));
  const allFilePaths = new Set(sourceFiles);

  const allIssues: CompletenessIssue[] = [];

  for (const filePath of sourceFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      allIssues.push(...checkUnresolvedImports(filePath, content, appPath, allFilePaths));
      allIssues.push(...checkPlaceholders(filePath, content, appPath));
      allIssues.push(...checkIncompleteComponents(filePath, content, appPath));
    } catch (err) {
      logger.warn(`Could not read file ${filePath}:`, err);
    }
  }

  allIssues.push(...checkMissingRoutePages(appPath, allFilePaths));

  // Prioritize: missing pages > unresolved imports > incomplete > todos
  // Limit to most critical issues to keep prompt manageable
  const MAX_ISSUES = 20;
  const prioritized = allIssues.slice(0, MAX_ISSUES);

  const isComplete = allIssues.length === 0;
  const followUpPrompt = isComplete ? null : buildFollowUpPrompt(prioritized);

  logger.info(
    `Completeness check: ${allIssues.length} issues found, isComplete=${isComplete}`,
  );

  return {
    isComplete,
    issues: prioritized,
    followUpPrompt,
  };
}

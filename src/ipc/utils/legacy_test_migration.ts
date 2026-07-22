import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import log from "electron-log";
import { E2E_TEST_DIR, LEGACY_TEST_DIR, SPEC_FILE_RE } from "../types/tests";

const logger = log.scope("legacy_test_migration");

/**
 * Glob for legacy Playwright specs. Deliberately `.ts` only (not the broader
 * `TEST_SPEC_GLOB` extension set): the migration targets the TypeScript specs
 * Dyad and users author, per the migration spec.
 */
export const LEGACY_TEST_SPEC_TS_GLOB = `${LEGACY_TEST_DIR}/**/*.spec.ts`;

/**
 * A legacy spec path must look like the paths the detection glob produces:
 * relative, under `tests/`, ending in `.spec.ts`, with no traversal, no
 * leading-dash segment, and no backslash/colon/control characters. Mirrors the
 * runner's `TEST_FILE_PATTERN` so a compromised renderer can't smuggle a
 * flag-like or traversing path into the move handler.
 */
const LEGACY_TEST_FILE_PATTERN = new RegExp(
  `^${LEGACY_TEST_DIR}/(?!.*\\.\\.)(?!(?:-|.*/-))[^\\\\:\\x00-\\x1f]+\\.spec\\.ts$`,
);

/**
 * Validate a renderer-supplied legacy spec path and return it normalized
 * (forward slashes, redundant segments collapsed), or null if it isn't a safe
 * `tests/….spec.ts` path.
 */
export function normalizeLegacyTestFile(file: string): string | null {
  const normalized = path.posix.normalize(file.replace(/\\/g, "/"));
  return LEGACY_TEST_FILE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * The `e2e-tests/…` destination for a legacy `tests/…` spec path. Replaces only
 * the leading `tests/` segment; the rest of the relative path is preserved.
 */
export function legacyToE2ePath(legacyFile: string): string {
  const rest = legacyFile.startsWith(`${LEGACY_TEST_DIR}/`)
    ? legacyFile.slice(LEGACY_TEST_DIR.length + 1)
    : legacyFile;
  return `${E2E_TEST_DIR}/${rest}`;
}

/** True when a file's contents reference the `@playwright/test` package. */
function importsPlaywright(content: string): boolean {
  // A substring check matches both `import … from "@playwright/test"` and
  // `require("@playwright/test")`. Mirrors the ad-hoc import detection used
  // elsewhere (e.g. app_upgrade_utils, framework_utils).
  return content.includes("@playwright/test");
}

/**
 * The relative paths of every `*.spec.ts` under the app's legacy `tests/`
 * directory that imports `@playwright/test`, sorted. The import check keeps
 * Playwright E2E specs and skips other `.spec.ts` files (e.g. Vitest unit
 * tests) that happen to live under `tests/`. Unreadable files are skipped.
 */
export async function detectLegacyPlaywrightSpecs(
  appPath: string,
): Promise<string[]> {
  const legacyDir = path.join(appPath, LEGACY_TEST_DIR);
  if (!fs.existsSync(legacyDir)) {
    return [];
  }
  const matches = await glob(LEGACY_TEST_SPEC_TS_GLOB, {
    cwd: appPath,
    nodir: true,
    posix: true,
  });
  const playwrightSpecs: string[] = [];
  for (const file of matches) {
    try {
      const content = await fs.promises.readFile(
        path.join(appPath, file),
        "utf8",
      );
      if (importsPlaywright(content)) {
        playwrightSpecs.push(file);
      }
    } catch (error) {
      logger.warn(
        `Failed to read ${file} while detecting legacy tests: ${error}`,
      );
    }
  }
  return playwrightSpecs.sort((a, b) => a.localeCompare(b));
}

// =============================================================================
// Support-file closure (carry a spec's imported fixtures/helpers along)
// =============================================================================

/** Every resolvable source file under the legacy `tests/` directory. */
const LEGACY_SOURCE_GLOB = `${LEGACY_TEST_DIR}/**/*.{ts,tsx,js,jsx}`;

/** Extensions tried when resolving an extensionless relative import. */
const RESOLVE_EXTENSIONS = ["ts", "tsx", "js", "jsx"] as const;

// Captures the specifier of `from "x"`, `import "x"`, `import("x")`, and
// `require("x")`. The trailing quote anchor keeps identifiers like `fromCache`
// from matching. Best-effort (regex, not a full parser) — matches the ad-hoc
// import detection used elsewhere in the codebase.
const IMPORT_SPECIFIER_RE =
  /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

/** Relative import specifiers ("./x", "../y") found in a file's content. */
export function parseRelativeImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  IMPORT_SPECIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_SPECIFIER_RE.exec(content)) !== null) {
    const specifier = match[1];
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

/** True when a `tests/`-relative path is itself a spec file. */
function isSpecFile(file: string): boolean {
  return SPEC_FILE_RE.test(file);
}

/**
 * Resolve a relative import from `fromFile` to a concrete file under `tests/`
 * using TS/JS resolution (exact, then `+ext`, then `/index.ext`). Returns the
 * posix path under `tests/`, or null when it doesn't resolve to a known file or
 * escapes `tests/`.
 */
function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  known: Set<string>,
): string | null {
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), specifier),
  );
  if (
    resolved !== LEGACY_TEST_DIR &&
    !resolved.startsWith(`${LEGACY_TEST_DIR}/`)
  ) {
    return null; // Escapes the tests/ directory.
  }
  const candidates = [
    resolved,
    ...RESOLVE_EXTENSIONS.map((ext) => `${resolved}.${ext}`),
    ...RESOLVE_EXTENSIONS.map((ext) => `${resolved}/index.${ext}`),
  ];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

interface LegacyImportGraph {
  files: string[];
  /** file -> the `tests/` files it imports. */
  imports: Map<string, Set<string>>;
  /** file -> the `tests/` files that import it. */
  importedBy: Map<string, Set<string>>;
}

/** Build the local import graph among all source files under `tests/`. */
async function buildLegacyImportGraph(
  appPath: string,
): Promise<LegacyImportGraph> {
  const files = (
    await glob(LEGACY_SOURCE_GLOB, { cwd: appPath, nodir: true, posix: true })
  ).sort();
  const known = new Set(files);
  const imports = new Map<string, Set<string>>();
  const importedBy = new Map<string, Set<string>>();
  for (const file of files) {
    imports.set(file, new Set());
    importedBy.set(file, new Set());
  }
  for (const file of files) {
    let content: string;
    try {
      content = await fs.promises.readFile(path.join(appPath, file), "utf8");
    } catch (error) {
      logger.warn(
        `Failed to read ${file} while graphing legacy tests: ${error}`,
      );
      continue;
    }
    for (const specifier of parseRelativeImportSpecifiers(content)) {
      const target = resolveRelativeImport(file, specifier, known);
      if (target && target !== file) {
        imports.get(file)!.add(target);
        importedBy.get(target)!.add(file);
      }
    }
  }
  return { files, imports, importedBy };
}

export interface LegacyMigrationPlan {
  /** Everything to move: the selected specs plus safe support files. */
  moveFiles: string[];
  /** Support files (fixtures/helpers) carried along, `tests/`-relative. */
  supportFiles: string[];
  /**
   * Support files a selected spec imports that CANNOT be moved because a file
   * staying behind still imports them. Left in `tests/`; the moved spec's
   * import to them will need manual attention.
   */
  sharedLeftBehind: string[];
}

/**
 * Given the specs the user chose to move, compute the full set of files to
 * relocate: the specs plus the fixtures/helpers they import (transitively).
 * A support file is only carried along when every file that imports it is also
 * being moved — a fixture shared with a spec that stays in `tests/` is left in
 * place so the stay-behind spec keeps working. Other spec files are never moved
 * as support (they move only when explicitly selected).
 */
export async function planLegacyMigration(
  appPath: string,
  selected: string[],
): Promise<LegacyMigrationPlan> {
  const graph = await buildLegacyImportGraph(appPath);
  const selectedSet = new Set(selected);

  // Support files reachable from the selected specs via imports. Don't descend
  // into (or collect) other spec files — those move only when selected.
  const reachable = new Set<string>();
  const stack = [...selected];
  while (stack.length > 0) {
    const file = stack.pop()!;
    for (const dep of graph.imports.get(file) ?? []) {
      if (isSpecFile(dep) || reachable.has(dep)) {
        continue;
      }
      reachable.add(dep);
      stack.push(dep);
    }
  }

  // Grow the movable set to a fixpoint: a support file is safe to move once
  // every file that imports it is already being moved (a selected spec or an
  // already-movable support file).
  const movableSupport = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of reachable) {
      if (movableSupport.has(file)) {
        continue;
      }
      const importers = graph.importedBy.get(file) ?? new Set<string>();
      const safe = [...importers].every(
        (importer) => selectedSet.has(importer) || movableSupport.has(importer),
      );
      if (safe) {
        movableSupport.add(file);
        changed = true;
      }
    }
  }

  const supportFiles = [...movableSupport].sort((a, b) => a.localeCompare(b));
  const sharedLeftBehind = [...reachable]
    .filter((file) => !movableSupport.has(file))
    .sort((a, b) => a.localeCompare(b));
  return {
    moveFiles: [...selected, ...supportFiles],
    supportFiles,
    sharedLeftBehind,
  };
}

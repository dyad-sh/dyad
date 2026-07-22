import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import log from "electron-log";
import {
  E2E_TEST_DIR,
  LEGACY_TEST_DIR,
  SPEC_FILE_RE,
  TEST_SPEC_EXTENSIONS,
  TEST_SPEC_EXT_ALTERNATION,
} from "../types/tests";

const logger = log.scope("legacy_test_migration");

/**
 * Glob for legacy Playwright specs. Uses the full `TEST_SPEC_EXTENSIONS` set
 * (the same single source of truth the runner globs `e2e-tests/` with) so
 * existing apps with `.spec.tsx/.js/.jsx` specs — which the pre-`e2e-tests/`
 * runner discovered — still get a migration offer instead of silently
 * disappearing from the panel.
 */
export const LEGACY_TEST_SPEC_GLOB = `${LEGACY_TEST_DIR}/**/*.spec.{${TEST_SPEC_EXTENSIONS.join(",")}}`;

/**
 * A legacy spec path must look like the paths the detection glob produces:
 * relative, under `tests/`, ending in a spec extension, with no traversal, no
 * leading-dash segment, and no backslash/colon/control characters. Mirrors the
 * runner's `TEST_FILE_PATTERN` so a compromised renderer can't smuggle a
 * flag-like or traversing path into the move handler.
 */
const LEGACY_TEST_FILE_PATTERN = new RegExp(
  `^${LEGACY_TEST_DIR}/(?!.*\\.\\.)(?!(?:-|.*/-))[^\\\\:\\x00-\\x1f]+\\.spec\\.(${TEST_SPEC_EXT_ALTERNATION})$`,
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

/**
 * True when a file actually imports the `@playwright/test` package. Matches an
 * import/require *specifier* (via `parseImportSpecifiers`) rather than a bare
 * substring, so a `.spec` file that merely mentions the package name in a
 * comment or string isn't mistaken for a Playwright spec.
 */
function importsPlaywright(content: string): boolean {
  return parseImportSpecifiers(content).includes("@playwright/test");
}

/**
 * The relative paths of every spec file under the app's legacy `tests/`
 * directory that imports `@playwright/test`, sorted. The import check keeps
 * Playwright E2E specs and skips other spec files (e.g. Vitest unit tests)
 * that happen to live under `tests/`. Unreadable files are skipped.
 */
export async function detectLegacyPlaywrightSpecs(
  appPath: string,
): Promise<string[]> {
  const legacyDir = path.join(appPath, LEGACY_TEST_DIR);
  if (!fs.existsSync(legacyDir)) {
    return [];
  }
  const matches = await glob(LEGACY_TEST_SPEC_GLOB, {
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

/** Every import/require specifier found in a file's content (best-effort). */
export function parseImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  IMPORT_SPECIFIER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_SPECIFIER_RE.exec(content)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** Relative import specifiers ("./x", "../y") found in a file's content. */
export function parseRelativeImportSpecifiers(content: string): string[] {
  return parseImportSpecifiers(content).filter(
    (specifier) => specifier.startsWith("./") || specifier.startsWith("../"),
  );
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

/** A selected spec that can't be moved without breaking an import. */
export interface BlockedLegacySpec {
  /** The selected spec left in `tests/`. */
  file: string;
  /** Why it can't be safely moved, surfaced to the user. */
  reason: string;
}

export interface LegacyMigrationPlan {
  /** Everything to move: the movable specs plus their support files. */
  moveFiles: string[];
  /** Selected specs that can move without breaking any import. */
  movableSpecs: string[];
  /** Support files (fixtures/helpers) carried along, `tests/`-relative. */
  supportFiles: string[];
  /**
   * Selected specs left in `tests/` because moving them would break an import:
   * a fixture they share stays behind, they depend on another (unselected)
   * spec, or a destination already exists. Each carries a reason for the UI.
   */
  blockedSpecs: BlockedLegacySpec[];
  /**
   * Support files reachable from the selected specs that are NOT being moved
   * (they belong to a blocked spec's component). Left in `tests/`; the paths
   * are `tests/…`-relative.
   */
  skippedSupportFiles: string[];
}

/**
 * Given the specs the user chose to move, compute what can be relocated safely.
 *
 * A relative import ties two files to the same fate: if one moves to
 * `e2e-tests/` and the other stays in `tests/`, the survivor's `./x` import
 * breaks. So we treat imports as *undirected* edges and work per connected
 * component. A component is movable only when every spec in it was selected and
 * no member's `e2e-tests/` destination already exists; otherwise the whole
 * component stays put and its selected specs are reported as blocked (rather
 * than completing a migration we know would break at module resolution). Other
 * spec files are never moved as support — they move only when selected, which
 * is exactly what keeps an unselected spec's component blocked.
 */
export async function planLegacyMigration(
  appPath: string,
  selected: string[],
): Promise<LegacyMigrationPlan> {
  const graph = await buildLegacyImportGraph(appPath);
  const selectedSet = new Set(selected);
  const known = new Set(graph.files);

  const destExists = (file: string): boolean =>
    fs.existsSync(path.join(appPath, legacyToE2ePath(file)));

  // Undirected neighbours: an import edge in either direction couples two files.
  const neighbors = (file: string): Set<string> =>
    new Set([
      ...(graph.imports.get(file) ?? []),
      ...(graph.importedBy.get(file) ?? []),
    ]);

  const movableSpecs: string[] = [];
  const blockedSpecs: BlockedLegacySpec[] = [];
  const supportSet = new Set<string>();
  const skippedSupportSet = new Set<string>();
  const visited = new Set<string>();

  for (const spec of selected) {
    if (!known.has(spec)) {
      // Offered a path that no longer resolves to a tests/ file.
      blockedSpecs.push({ file: spec, reason: "Source file no longer exists" });
      continue;
    }
    if (visited.has(spec)) {
      continue; // Already assessed via another selected spec in its component.
    }

    // Flood the undirected component containing this spec.
    const component: string[] = [];
    const seen = new Set<string>([spec]);
    const stack = [spec];
    while (stack.length > 0) {
      const file = stack.pop()!;
      component.push(file);
      visited.add(file);
      for (const next of neighbors(file)) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }

    const selectedSpecsInComponent = component.filter(
      (f) => isSpecFile(f) && selectedSet.has(f),
    );
    const supportInComponent = component.filter((f) => !isSpecFile(f));
    const collision = component.find((f) => destExists(f));
    const unselectedSpec = component.find(
      (f) => isSpecFile(f) && !selectedSet.has(f),
    );

    let reason: string | null = null;
    if (collision) {
      reason = isSpecFile(collision)
        ? `${legacyToE2ePath(collision)} already exists`
        : `A fixture it needs (${legacyToE2ePath(collision)}) already exists`;
    } else if (unselectedSpec) {
      reason =
        "Shares fixtures with tests you didn't select — move those together, or migrate manually.";
    }

    if (reason) {
      for (const s of selectedSpecsInComponent) {
        blockedSpecs.push({ file: s, reason });
      }
      for (const f of supportInComponent) {
        skippedSupportSet.add(f);
      }
    } else {
      for (const s of selectedSpecsInComponent) {
        movableSpecs.push(s);
      }
      for (const f of supportInComponent) {
        supportSet.add(f);
      }
    }
  }

  const supportFiles = [...supportSet].sort((a, b) => a.localeCompare(b));
  const skippedSupportFiles = [...skippedSupportSet].sort((a, b) =>
    a.localeCompare(b),
  );
  movableSpecs.sort((a, b) => a.localeCompare(b));
  blockedSpecs.sort((a, b) => a.file.localeCompare(b.file));
  return {
    moveFiles: [...movableSpecs, ...supportFiles],
    movableSpecs,
    supportFiles,
    blockedSpecs,
    skippedSupportFiles,
  };
}

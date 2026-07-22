import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import log from "electron-log";
import { E2E_TEST_DIR, LEGACY_TEST_DIR } from "../types/tests";

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

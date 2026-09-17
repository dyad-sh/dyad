import path from "node:path";

import { E2E_TEST_DIR } from "../types/tests";

interface PlaywrightDiscoveryTest {
  expectedStatus?: string;
}

interface PlaywrightDiscoverySpec {
  title?: string;
  file?: string;
  line?: number;
  tests?: PlaywrightDiscoveryTest[];
}

interface PlaywrightDiscoverySuite {
  title?: string;
  file?: string;
  specs?: PlaywrightDiscoverySpec[];
  suites?: PlaywrightDiscoverySuite[];
}

export interface PlaywrightDiscoveryReport {
  config?: { rootDir?: string };
  suites?: PlaywrightDiscoverySuite[];
  errors?: Array<{ message?: string }>;
}

export interface DiscoveredPreviewTest {
  file: string;
  line: number;
  title: string;
  fullTitle: string;
  skipped: boolean;
}

function normalizeFile(
  file: string,
  appPath: string,
  reportRoot: string,
): string {
  // JSON locations are relative to config.rootDir (usually e2e-tests/), not
  // the app root. Canonical app-relative paths let the runner select exact
  // absolute filenames instead of ambiguous suffix regexes.
  const relative = path.relative(appPath, path.resolve(reportRoot, file));
  return relative.replace(/\\/g, "/");
}

function collectTests(
  suite: PlaywrightDiscoverySuite,
  appPath: string,
  reportRoot: string,
  inheritedFile: string | undefined,
  inheritedTitles: string[],
  out: DiscoveredPreviewTest[],
  isFileSuite: boolean,
): void {
  const file = suite.file ?? inheritedFile;
  // Playwright's outer suite is named after the spec file. It participates in
  // grep internally, but it is not part of the user-visible test title. Keep
  // only describe titles here; the exact runner grep matches this as a suffix.
  //
  // The JSON reporter merges per file at the top level, so depth is the only
  // reliable discriminator: `file` is set on *every* serialized suite, describe
  // blocks included, so testing it here would swallow every describe title.
  const titles =
    isFileSuite || !suite.title
      ? inheritedTitles
      : [...inheritedTitles, suite.title];

  for (const spec of suite.specs ?? []) {
    const specFile = spec.file ?? file;
    if (!specFile || !spec.title || !spec.line) continue;
    const declaredTests = spec.tests ?? [];
    out.push({
      file: normalizeFile(specFile, appPath, reportRoot),
      line: spec.line,
      title: spec.title,
      fullTitle: [...titles, spec.title].join(" "),
      skipped:
        declaredTests.length > 0 &&
        declaredTests.every((test) => test.expectedStatus === "skipped"),
    });
  }

  for (const child of suite.suites ?? []) {
    collectTests(child, appPath, reportRoot, file, titles, out, false);
  }
}

export function parsePreviewTestDiscovery(
  report: PlaywrightDiscoveryReport,
  appPath: string,
): { tests: DiscoveredPreviewTest[]; errors: string[] } {
  const tests: DiscoveredPreviewTest[] = [];
  const reportRoot = report.config?.rootDir ?? appPath;
  for (const suite of report.suites ?? []) {
    collectTests(suite, appPath, reportRoot, undefined, [], tests, true);
  }

  return {
    tests,
    errors:
      report.errors
        ?.map((error) => error.message)
        .filter((message): message is string => Boolean(message)) ?? [],
  };
}

/**
 * Playwright greps against a title path that can include project and file
 * prefixes. Match the discovered describe/test title exactly at the end while
 * allowing those runner-owned prefixes.
 */
export function exactDiscoveredTitleGrep(
  file: string,
  fullTitle: string,
): string {
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const testDirPrefix = `${E2E_TEST_DIR}/`;
  const titlePath = file.startsWith(testDirPrefix)
    ? file.slice(testDirPrefix.length)
    : file;
  return `(?:^|\\s)${escape(titlePath)}\\s+${escape(fullTitle)}$`;
}

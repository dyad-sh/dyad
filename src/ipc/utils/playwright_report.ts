import path from "node:path";
import type { TestResult, TestRunStatus } from "../types/tests";

// =============================================================================
// Minimal shape of the Playwright JSON report we depend on.
// =============================================================================

interface PwAttachment {
  name: string;
  path?: string;
  contentType?: string;
}

interface PwTestResult {
  status?: string; // "passed" | "failed" | "timedOut" | "skipped" | "interrupted"
  duration?: number;
  error?: { message?: string; stack?: string };
  errors?: { message?: string }[];
  attachments?: PwAttachment[];
}

interface PwTest {
  results?: PwTestResult[];
}

interface PwSpec {
  title?: string;
  ok?: boolean;
  file?: string;
  tests?: PwTest[];
}

interface PwSuite {
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

export interface PwReport {
  suites?: PwSuite[];
  errors?: { message?: string }[];
}

/**
 * Heuristic infra-vs-assertion classifier for a Playwright error message.
 *
 * Infra/inconclusive (amber) → the *test* needs a fix: selector didn't match,
 * the page never loaded, the dev server was unreachable, a timeout. Assertion
 * (red) → the *app* behavior didn't match what the test expects.
 *
 * This is intentionally heuristic; the levers in the system prompt
 * (role/text locators + auto-waiting) keep most real failures on the
 * assertion side.
 */
export function classifyErrorText(
  errorText: string | undefined,
): "infra" | "assertion" {
  if (!errorText) return "assertion";
  const text = errorText.toLowerCase();
  const infraSignals = [
    "timed out",
    "waiting for",
    "strict mode violation",
    "no element",
    "not found",
    "target closed",
    "target page, context or browser has been closed",
    "net::err",
    "econnrefused",
    "err_connection_refused",
    "navigation",
    "browsertype.launch",
    "executable doesn't exist",
    "please run the following command to download",
  ];
  if (infraSignals.some((s) => text.includes(s))) {
    return "infra";
  }
  return "assertion";
}

function resultErrorText(r: PwTestResult): string | undefined {
  if (r.error?.message) return r.error.message;
  if (r.errors && r.errors.length > 0) {
    return r.errors
      .map((e) => e.message)
      .filter(Boolean)
      .join("\n");
  }
  return undefined;
}

function screenshotFromResult(r: PwTestResult): string | undefined {
  const shot = r.attachments?.find(
    (a) => a.name === "screenshot" && typeof a.path === "string",
  );
  return shot?.path;
}

interface SpecWithFile {
  spec: PwSpec;
  /** Resolved file path: spec's own, or inherited from an ancestor suite. */
  file: string;
}

/**
 * Walk the suite tree, pairing each spec with a file path. Playwright reports
 * `file` on the top-level (per-file) suite; nested `describe` suites and the
 * specs themselves may omit it, so we inherit the nearest ancestor's file.
 */
function collectSpecs(
  suite: PwSuite,
  inheritedFile: string | undefined,
  out: SpecWithFile[],
): void {
  const file = suite.file ?? inheritedFile;
  if (suite.specs) {
    for (const spec of suite.specs) {
      out.push({ spec, file: spec.file ?? file ?? "" });
    }
  }
  if (suite.suites) {
    for (const child of suite.suites) {
      collectSpecs(child, file, out);
    }
  }
}

/**
 * Parse a Playwright JSON report into per-spec-file results. Multiple `test()`
 * blocks in one file are aggregated to a single file-level status: infra wins
 * over assertion wins over pass (so a flaky/broken-test file never reads as
 * "you broke your app").
 */
export function parsePlaywrightReport(
  report: PwReport,
  appPath: string,
): TestResult[] {
  const specs: SpecWithFile[] = [];
  for (const suite of report.suites ?? []) {
    collectSpecs(suite, undefined, specs);
  }

  const byFile = new Map<
    string,
    {
      durationMs: number;
      hasInfra: boolean;
      hasAssertion: boolean;
      sawResult: boolean;
      error?: string;
      screenshotPath?: string;
    }
  >();

  for (const { spec, file: rawFile } of specs) {
    if (!rawFile) continue;
    const file = path.isAbsolute(rawFile)
      ? path.relative(appPath, rawFile)
      : rawFile;
    // Normalize all separators to POSIX. A global replace is more robust than
    // split(path.sep) because Playwright may report mixed separators on Windows.
    const normalized = file.replace(/\\/g, "/");

    const entry =
      byFile.get(normalized) ??
      ({
        durationMs: 0,
        hasInfra: false,
        hasAssertion: false,
        sawResult: false,
      } as {
        durationMs: number;
        hasInfra: boolean;
        hasAssertion: boolean;
        sawResult: boolean;
        error?: string;
        screenshotPath?: string;
      });

    for (const test of spec.tests ?? []) {
      const results = test.results ?? [];
      const final = results[results.length - 1];
      if (!final) continue;
      entry.sawResult = true;
      entry.durationMs += final.duration ?? 0;

      const status = final.status ?? "";
      if (status === "passed" || status === "skipped") continue;

      const errText = resultErrorText(final);
      const kind =
        status === "timedOut" || status === "interrupted"
          ? "infra"
          : classifyErrorText(errText);

      if (kind === "infra") {
        entry.hasInfra = true;
      } else {
        entry.hasAssertion = true;
      }
      if (!entry.error && errText) entry.error = errText;
      if (!entry.screenshotPath) {
        entry.screenshotPath = screenshotFromResult(final);
      }
    }

    byFile.set(normalized, entry);
  }

  const results: TestResult[] = [];
  for (const [file, entry] of byFile) {
    let status: TestRunStatus;
    if (entry.hasInfra && !entry.hasAssertion) {
      status = "inconclusive";
    } else if (entry.hasAssertion) {
      status = "failed";
    } else {
      status = "passed";
    }
    results.push({
      file,
      status,
      durationMs: entry.durationMs || undefined,
      error: entry.error,
      screenshotPath: entry.screenshotPath,
    });
  }

  results.sort((a, b) => a.file.localeCompare(b.file));
  return results;
}

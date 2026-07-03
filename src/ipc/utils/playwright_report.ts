import path from "node:path";
import type { TestCaseResult, TestResult, TestRunStatus } from "../types/tests";

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
  /**
   * Playwright's own annotation-aware verdict for the test:
   * "expected" | "unexpected" | "flaky" | "skipped". Unlike the raw per-run
   * result status, this accounts for `test.fail()` (an expected failure) and
   * retries (flaky = eventually passed).
   */
  status?: string;
  results?: PwTestResult[];
}

interface PwSpec {
  title?: string;
  ok?: boolean;
  file?: string;
  /** 1-based line of the `test(` call in the source file. */
  line?: number;
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
 * Reduce one spec (a single `test()` declaration, possibly run across projects
 * with retries) to its final per-test result. Returns null when the spec
 * produced no result (e.g. filtered out / not run).
 */
function reduceSpec(spec: PwSpec): TestCaseResult | null {
  let durationMs = 0;
  let hasInfra = false;
  let hasAssertion = false;
  let hasPassed = false;
  let hasSkipped = false;
  let sawResult = false;
  let error: string | undefined;
  let screenshotPath: string | undefined;

  for (const test of spec.tests ?? []) {
    const results = test.results ?? [];
    const final = results[results.length - 1];
    if (!final) continue;
    sawResult = true;
    durationMs += final.duration ?? 0;

    // Trust Playwright's annotation-aware verdict first: a `test.fail()` spec
    // that failed as expected reports raw status "failed" but test-level
    // "expected", and a retry that eventually passed reports "flaky". Both are
    // green to Playwright, so don't paint them red/amber here.
    if (test.status === "expected" || test.status === "flaky") {
      hasPassed = true;
      continue;
    }
    const status = final.status ?? "";
    if (status === "passed") {
      // A passing run that Playwright still calls "unexpected" is a
      // `test.fail()` expectation that passed — a real assertion-level failure
      // despite the green raw status.
      if (test.status === "unexpected") {
        hasAssertion = true;
        if (!error) {
          error =
            resultErrorText(final) ??
            "Playwright marked this test as unexpected (for example, a test.fail() expectation passed).";
        }
        if (!screenshotPath) screenshotPath = screenshotFromResult(final);
      } else {
        hasPassed = true;
      }
      continue;
    }
    // A skipped test never executed — don't let it roll up as a green "passed".
    if (status === "skipped") {
      hasSkipped = true;
      continue;
    }

    // NOTE: every genuinely failing test reaches here with test-level status
    // "unexpected" — that's Playwright's outcome for any real failure,
    // including timeouts — so the infra-vs-assertion split below must run on
    // the raw per-run result and never short-circuit on "unexpected".
    const errText = resultErrorText(final);
    const kind =
      status === "timedOut" || status === "interrupted"
        ? "infra"
        : classifyErrorText(errText);

    if (kind === "infra") {
      hasInfra = true;
    } else {
      hasAssertion = true;
    }
    if (!error && errText) error = errText;
    if (!screenshotPath) screenshotPath = screenshotFromResult(final);
  }

  if (!sawResult) return null;

  let status: TestRunStatus;
  if (hasAssertion) {
    status = "failed";
  } else if (hasInfra) {
    status = "inconclusive";
  } else if (hasSkipped && !hasPassed) {
    // The spec only ever skipped (never ran a passing result) — surface it as
    // inconclusive rather than a misleading green pass.
    status = "inconclusive";
  } else {
    status = "passed";
  }

  return {
    title: spec.title ?? "(unnamed test)",
    line: spec.line,
    status,
    durationMs: durationMs || undefined,
    error,
    screenshotPath,
  };
}

/**
 * Roll an array of per-test results up to a file-level result. Infra wins over
 * pass, assertion wins over infra (so a flaky/broken-test file never reads as
 * "you broke your app").
 */
export function aggregateTestResults(
  file: string,
  tests: TestCaseResult[],
): TestResult {
  let durationMs = 0;
  let hasInfra = false;
  let hasAssertion = false;
  let error: string | undefined;
  let screenshotPath: string | undefined;

  for (const t of tests) {
    durationMs += t.durationMs ?? 0;
    if (t.status === "failed") hasAssertion = true;
    else if (t.status === "inconclusive") hasInfra = true;
    if (t.status !== "passed") {
      if (!error && t.error) error = t.error;
      if (!screenshotPath && t.screenshotPath) {
        screenshotPath = t.screenshotPath;
      }
    }
  }

  let status: TestRunStatus;
  if (hasAssertion) {
    status = "failed";
  } else if (hasInfra) {
    status = "inconclusive";
  } else {
    status = "passed";
  }

  return {
    file,
    status,
    durationMs: durationMs || undefined,
    error,
    screenshotPath,
    tests,
  };
}

/**
 * Parse a Playwright JSON report into per-spec-file results. Each result also
 * carries its individual `test()` cases (`tests`) so the UI can show a tree and
 * surface per-test status; the file-level status aggregates them.
 */
export function parsePlaywrightReport(
  report: PwReport,
  appPath: string,
): TestResult[] {
  const specs: SpecWithFile[] = [];
  for (const suite of report.suites ?? []) {
    collectSpecs(suite, undefined, specs);
  }

  const byFile = new Map<string, TestCaseResult[]>();

  for (const { spec, file: rawFile } of specs) {
    if (!rawFile) continue;
    const file = path.isAbsolute(rawFile)
      ? path.relative(appPath, rawFile)
      : rawFile;
    // Normalize all separators to POSIX. A global replace is more robust than
    // split(path.sep) because Playwright may report mixed separators on Windows.
    const normalized = file.replace(/\\/g, "/");

    const caseResult = reduceSpec(spec);
    if (!caseResult) continue;

    const entry = byFile.get(normalized) ?? [];
    entry.push(caseResult);
    byFile.set(normalized, entry);
  }

  const results: TestResult[] = [];
  for (const [file, tests] of byFile) {
    tests.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    results.push(aggregateTestResults(file, tests));
  }

  results.sort((a, b) => a.file.localeCompare(b.file));
  return results;
}

import type { RuntimeTestResult, TestStatus } from "@/atoms/testRuntimeAtoms";
import type { TestCase, TestCaseResult, TestResult } from "@/ipc/types";

/**
 * Maps a Playwright-reported spec path onto a key from our spec list. The
 * report's path base can differ from the glob's (e.g. missing the "tests/"
 * prefix or being absolute), so we fall back from exact -> suffix -> basename.
 * Returns the original path when no unambiguous match exists.
 */
export function reconcileResultFile(
  resultFile: string,
  specFiles: string[],
): string {
  const normalized = resultFile.replace(/\\/g, "/");
  if (specFiles.includes(normalized)) return normalized;

  // Require a path-separator boundary so a shorter name can't spuriously match
  // a longer sibling (e.g. "auth.spec.ts" must not match "google-auth.spec.ts").
  const suffixMatches = specFiles.filter(
    (f) => f.endsWith("/" + normalized) || normalized.endsWith("/" + f),
  );
  if (suffixMatches.length === 1) return suffixMatches[0];

  const base = normalized.split("/").pop();
  const baseMatches = specFiles.filter((f) => f.split("/").pop() === base);
  if (baseMatches.length === 1) return baseMatches[0];

  return normalized;
}

/** Stable key for an individual test ("file:line"), used for run tracking. */
export function testKey(file: string, line: number | undefined): string {
  return line != null ? `${file}:${line}` : file;
}

/** Find the result for a single test within a file's result, by line then title. */
export function findCaseResult(
  result: RuntimeTestResult | undefined,
  testCase: TestCase,
): TestCaseResult | undefined {
  if (!result?.tests) return undefined;
  return (
    result.tests.find((t) => t.line != null && t.line === testCase.line) ??
    result.tests.find((t) => t.title === testCase.title)
  );
}

/**
 * Merge per-test results from a single-test run back into a file's existing
 * results, replacing the matched test and keeping the rest. Used so running one
 * test doesn't wipe the statuses of its siblings.
 */
export function mergeCaseResults(
  existing: TestCaseResult[] | undefined,
  incoming: TestCaseResult[],
): TestCaseResult[] {
  const merged = [...(existing ?? [])];
  for (const inc of incoming) {
    const idx = merged.findIndex(
      (t) =>
        (t.line != null && inc.line != null && t.line === inc.line) ||
        t.title === inc.title,
    );
    if (idx >= 0) merged[idx] = inc;
    else merged.push(inc);
  }
  merged.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return merged;
}

/** Roll per-test results up to a file-level result (assertion > infra > pass). */
export function aggregateFileResult(
  file: string,
  tests: TestCaseResult[],
): TestResult {
  let durationMs = 0;
  let hasFailed = false;
  let hasInfra = false;
  let error: string | undefined;
  let screenshotPath: string | undefined;
  for (const t of tests) {
    durationMs += t.durationMs ?? 0;
    if (t.status === "failed") hasFailed = true;
    else if (t.status === "inconclusive") hasInfra = true;
    if (t.status !== "passed") {
      if (!error && t.error) error = t.error;
      if (!screenshotPath && t.screenshotPath)
        screenshotPath = t.screenshotPath;
    }
  }
  return {
    file,
    status: hasFailed ? "failed" : hasInfra ? "inconclusive" : "passed",
    durationMs: durationMs || undefined,
    error,
    screenshotPath,
    tests,
  };
}

function allKnownCasesCovered(
  knownTests: TestCase[],
  results: TestCaseResult[],
): boolean {
  if (knownTests.length === 0) return true;
  return knownTests.every((testCase) =>
    results.some(
      (result) =>
        (result.line != null && result.line === testCase.line) ||
        result.title === testCase.title,
    ),
  );
}

function buildPartialAwareResult({
  file,
  knownTests,
  tests,
}: {
  file: string;
  knownTests: TestCase[];
  tests: TestCaseResult[];
}): RuntimeTestResult {
  const aggregated = aggregateFileResult(file, tests);
  if (
    aggregated.status === "passed" &&
    !allKnownCasesCovered(knownTests, tests)
  ) {
    return { ...aggregated, status: "partial" };
  }
  return aggregated;
}

export function buildSingleTestFileResult({
  file,
  knownTests,
  previous,
  incoming,
}: {
  file: string;
  knownTests: TestCase[];
  previous: RuntimeTestResult | undefined;
  incoming: TestResult;
}): RuntimeTestResult {
  const incomingTests = incoming.tests ?? [];
  if (incomingTests.length === 0 && !previous?.tests?.length) {
    if (incoming.status === "passed" && knownTests.length > 1) {
      return { ...incoming, file, status: "partial" };
    }
    return { ...incoming, file };
  }

  const mergedTests = mergeCaseResults(previous?.tests, incomingTests);
  return buildPartialAwareResult({ file, knownTests, tests: mergedTests });
}

export function statusLabel(status: TestStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "partial":
      return "Partially run";
    case "failed":
      return "Test failed - your app may not match the test";
    case "inconclusive":
      return "Couldn't run - needs a fix to the test";
    case "running":
      return "Running";
    case "not-run":
    default:
      return "Not run yet";
  }
}

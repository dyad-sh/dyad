import type { RunAppTestsResult, TestResult } from "@/ipc/types/tests";
import { PLAYWRIGHT_REPORT_ERROR_FILE } from "@/ipc/utils/playwright_report";
import { normalizeRunTestFile } from "@/ipc/handlers/tests_handlers";
import { isFailingStatus } from "./test_failure_signature";
import { AgentContext, escapeXmlAttr, escapeXmlContent } from "./types";

export { isFailingStatus };

/** Fix attempts allowed per spec per turn before the tool refuses to rerun. */
export const MAX_ATTEMPTS = 4;
/** Actual Playwright runs allowed in one agent turn across all specs. */
export const MAX_RUNS_PER_TURN = 10;
/** Hard wall-clock cap so one run can't stall the whole agent turn. */
export const RUN_TIMEOUT_MS = 10 * 60_000;
/** Cap on the error text echoed back to the model (matches askAiToFix). */
export const MAX_ERROR_CHARS = 4000;

export function specKey(testFile: string): string {
  return normalizeRunTestFile(testFile) ?? testFile;
}

export interface Classification {
  kind: "passed" | "failed" | "infra" | "no-tests";
  passed: number;
  failed: number;
  /** Deliberately-skipped tests (`test.skip`/`test.fixme`) — never failures. */
  skipped: number;
  /**
   * True when every non-passing test was an "inconclusive" result — a
   * selector/timeout/strict-mode/navigation error rather than a plain
   * assertion. These are still real failures the agent should fix (usually a
   * locator or timing bug in the test), but the hint nudges it to also consider
   * that the page may not have loaded.
   */
  allInconclusive: boolean;
  message?: string;
}

/**
 * Skipped tests (`test.skip`/`test.fixme`) surface in the report as
 * "inconclusive" verdicts WITHOUT an error; a real selector/timeout failure
 * always carries one.
 */
function isSkippedVerdict(v: { status: TestResult["status"]; error?: string }) {
  return v.status === "inconclusive" && !v.error;
}

export function classify(res: RunAppTestsResult): Classification {
  const runnerError = res.results.find(
    (r) => r.file === PLAYWRIGHT_REPORT_ERROR_FILE,
  );
  if (res.infraError || runnerError) {
    return {
      kind: "infra",
      passed: 0,
      failed: 0,
      skipped: 0,
      allInconclusive: false,
      message: res.infraError?.message ?? runnerError?.error,
    };
  }
  if (res.results.length === 0) {
    // Playwright ran but matched no tests: the target path/line points at
    // nothing (a mistyped or wrong-directory path, or a spec that wasn't
    // written where expected) or the file is empty. This is fixable by the
    // agent — surface the real spec paths so it can retry, rather than
    // dead-ending as an "infrastructure problem".
    return {
      kind: "no-tests",
      passed: 0,
      failed: 0,
      skipped: 0,
      allInconclusive: false,
    };
  }
  // Count individual test() verdicts, not spec files — a file result's status
  // is an aggregate, so counting files would report a spec with several
  // passing tests and one failure as "0 passed, 1 failed".
  const verdicts = res.results.flatMap(
    (r): { status: TestResult["status"]; error?: string }[] =>
      r.tests && r.tests.length > 0 ? r.tests : [r],
  );
  const passed = verdicts.filter((v) => v.status === "passed").length;
  const assertionFailures = verdicts.filter(
    (v) => v.status === "failed",
  ).length;
  // A deliberately skipped test must never read as a failure — a spec that is
  // green except for one `test.skip` would otherwise be reported FAILED every
  // run, never record its pass, and drain the whole fix budget on a
  // non-failure.
  const skipped = verdicts.filter(isSkippedVerdict).length;
  const inconclusiveFailures = verdicts.filter(
    (v) => v.status === "inconclusive" && v.error,
  ).length;
  const failed = assertionFailures + inconclusiveFailures;
  // When NOTHING ran — no pass, no failure, only skips — the spec has no
  // runnable test, which the agent fixes by un-skipping, not by burning a fix
  // attempt on locator-failure guidance.
  if (passed === 0 && failed === 0 && skipped > 0) {
    return {
      kind: "no-tests",
      passed: 0,
      failed: 0,
      skipped,
      allInconclusive: false,
    };
  }
  if (failed > 0) {
    return {
      kind: "failed",
      passed,
      failed,
      skipped,
      allInconclusive: assertionFailures === 0,
    };
  }
  return { kind: "passed", passed, failed: 0, skipped, allInconclusive: false };
}

/** First failure screenshot in the report, with its owning spec file. */
export function findFirstScreenshot(
  results: TestResult[],
): { file: string; screenshotPath: string } | null {
  for (const r of results) {
    if (r.screenshotPath) {
      return { file: r.file, screenshotPath: r.screenshotPath };
    }
    for (const t of r.tests ?? []) {
      if (t.screenshotPath) {
        return { file: r.file, screenshotPath: t.screenshotPath };
      }
    }
  }
  return null;
}

/** One "FAILED file > title" line per failing test (or per file if untitled). */
export function listFailedTests(results: TestResult[]): string[] {
  const lines: string[] = [];
  for (const r of results) {
    if (!isFailingStatus(r.status)) continue;
    const failingTests = (r.tests ?? []).filter(
      (t) => isFailingStatus(t.status) && !isSkippedVerdict(t),
    );
    if (failingTests.length > 0) {
      for (const t of failingTests) {
        lines.push(`FAILED ${r.file} > "${t.title}"`);
      }
    } else if (!isSkippedVerdict(r)) {
      lines.push(`FAILED ${r.file}`);
    }
  }
  return lines;
}

export function firstFailureError(results: TestResult[]): string {
  return (
    results.find((r) => isFailingStatus(r.status) && r.error)?.error ??
    results
      .flatMap((r) => r.tests ?? [])
      .find((t) => isFailingStatus(t.status) && t.error)?.error ??
    ""
  );
}

export function truncateError(error: string): string {
  const trimmed = error.trim();
  return trimmed.length > MAX_ERROR_CHARS
    ? `…(truncated)\n${trimmed.slice(-MAX_ERROR_CHARS)}`
    : trimmed;
}

/**
 * Describe how the run was isolated, for the agent (and, via the tool reply,
 * the user). Only `neon-branch` is a genuine throwaway copy, so it's the only
 * mode that may claim real data was untouched. A `supabase-test-user` run
 * executes against the app's REAL project — Row-Level Security is the only
 * thing scoping it — so it states what we did (tested with a test user) rather
 * than promising what didn't happen. `reason` (tables without RLS, RLS Dyad
 * couldn't verify, or why isolation was skipped) is appended rather than
 * dropped: it's precisely the case where a blanket safety claim would be false.
 *
 * The `mode` enum must never reach the text: this string is both the tool
 * result AND the body of the <dyad-status> card the user reads in chat, so it
 * says what happened in plain words instead of naming an internal identifier.
 */
export function isolationLine(res: RunAppTestsResult): string {
  const isolation = res.isolation;
  const mode = isolation?.mode ?? "none";
  const summary =
    mode === "neon-branch"
      ? "Tests ran against a temporary copy of the database — your real data was not touched."
      : mode === "supabase-test-user"
        ? "The app was tested using a temporary test user."
        : "Tests ran against the app's current database.";
  return isolation?.reason ? `${summary} ${isolation.reason}` : summary;
}

export function completeWarning(
  ctx: AgentContext,
  title: string,
  body: string,
): void {
  ctx.onXmlComplete(
    `<dyad-output type="warning" message="${escapeXmlAttr(title)}">\n${escapeXmlContent(body)}\n</dyad-output>`,
  );
}

export function completeStatus(
  ctx: AgentContext,
  title: string,
  body: string,
): void {
  ctx.onXmlComplete(
    `<dyad-status title="${escapeXmlAttr(title)}">\n${escapeXmlContent(body)}\n</dyad-status>`,
  );
}

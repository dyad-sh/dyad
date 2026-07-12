import type { RunAppTestsResult, TestResult } from "@/ipc/types/tests";
import { PLAYWRIGHT_REPORT_ERROR_FILE } from "@/ipc/utils/playwright_report";
import { normalizeRunTestFile } from "@/ipc/handlers/tests_handlers";
import {
  AgentContext,
  FileEditTracker,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";

/** Fix attempts allowed per spec per turn before the tool refuses to rerun. */
export const MAX_ATTEMPTS = 4;
/** Hard wall-clock cap so one run can't stall the whole agent turn. */
export const RUN_TIMEOUT_MS = 10 * 60_000;
/** Cap on the error text echoed back to the model (matches askAiToFix). */
export const MAX_ERROR_CHARS = 4000;

export function specKey(testFile: string): string {
  return normalizeRunTestFile(testFile) ?? testFile;
}

/** Total file edits so far this turn — the require-a-change guard's signal. */
export function sumFileEdits(tracker: FileEditTracker): number {
  let total = 0;
  for (const counts of Object.values(tracker)) {
    total += (counts.write_file ?? 0) + (counts.search_replace ?? 0);
  }
  return total;
}

export interface Classification {
  kind: "passed" | "failed" | "infra" | "no-tests";
  passed: number;
  failed: number;
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
 * A test that RAN and didn't pass — both "failed" (assertion) and
 * "inconclusive" (selector/timeout/strict-mode, which Playwright's error
 * heuristic flags as infra-ish) count. Only a whole-run failure that produced
 * NO report — surfaced separately as `infraError` — is a true environment
 * problem; anything with a per-test verdict is a fixable test result.
 */
export function isFailingStatus(status: string): boolean {
  return status === "failed" || status === "inconclusive";
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
      allInconclusive: false,
    };
  }
  const passed = res.results.filter((r) => r.status === "passed").length;
  const assertionFailures = res.results.filter(
    (r) => r.status === "failed",
  ).length;
  const inconclusive = res.results.filter(
    (r) => r.status === "inconclusive",
  ).length;
  const failed = assertionFailures + inconclusive;
  if (failed > 0) {
    return {
      kind: "failed",
      passed,
      failed,
      allInconclusive: assertionFailures === 0,
    };
  }
  return { kind: "passed", passed, failed: 0, allInconclusive: false };
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
    const failingTests = (r.tests ?? []).filter((t) =>
      isFailingStatus(t.status),
    );
    if (failingTests.length > 0) {
      for (const t of failingTests) {
        lines.push(`FAILED ${r.file} > "${t.title}"`);
      }
    } else {
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

export function isolationLine(res: RunAppTestsResult): string {
  const mode = res.isolation?.mode ?? "none";
  if (mode === "none") {
    return "Database isolation: none (tests ran against the app's current database).";
  }
  return `Database isolation: ${mode} (your real data was not touched).`;
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

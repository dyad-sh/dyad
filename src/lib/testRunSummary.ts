import type { TestsRunStatePayload } from "@/ipc/types/tests";
import type { TestRunRequest } from "@/test_run_queue/state";

export type CompletedTestRun = TestRunRequest & {
  status: "passed" | "failed" | "inconclusive";
};

/** Keep only compact results, not logs/screenshots, for the chat queue card. */
export function summarizeTestRun(
  payload: TestsRunStatePayload,
): CompletedTestRun {
  const results = payload.results ?? [];
  return {
    runId: payload.runId,
    source: payload.source,
    chatId: payload.chatId,
    testFile: payload.testFile,
    testFiles: payload.testFiles,
    testLine: payload.testLine,
    grep: payload.grep,
    // Only a real failed test result is "failed"; an infrastructure, stop, or
    // cleanup error is inconclusive, matching the Tests panel's amber banner.
    status: results.some((result) => result.status === "failed")
      ? "failed"
      : payload.infraError ||
          results.length === 0 ||
          results.some(
            (result) => result.incomplete || result.status === "inconclusive",
          )
        ? "inconclusive"
        : "passed",
  };
}

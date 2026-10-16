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
    testFile: payload.testFile,
    testFiles: payload.testFiles,
    testLine: payload.testLine,
    grep: payload.grep,
    status:
      payload.infraError || results.some((result) => result.status === "failed")
        ? "failed"
        : results.length === 0 ||
            results.some(
              (result) => result.incomplete || result.status === "inconclusive",
            )
          ? "inconclusive"
          : "passed",
  };
}

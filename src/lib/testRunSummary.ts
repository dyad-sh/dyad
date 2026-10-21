import type { TestsRunStatePayload } from "@/ipc/types/tests";
import type { TestRunStopReason } from "@/shared/test_run_stop";
import type { TestRunRequest } from "@/test_run_queue/state";

export type CompletedTestRun = TestRunRequest & {
  status: "passed" | "failed" | "inconclusive" | "stopped";
  /** Why a stopped run stopped, when main recorded a cause. */
  stopReason?: TestRunStopReason;
};

/** Keep only compact results, not logs/screenshots, for the chat queue card. */
export function summarizeTestRun(
  payload: TestsRunStatePayload,
): CompletedTestRun {
  const results = payload.results ?? [];
  const stopReason = payload.infraError?.stopReason;
  return {
    runId: payload.runId,
    source: payload.source,
    chatId: payload.chatId,
    testFile: payload.testFile,
    testFiles: payload.testFiles,
    testLine: payload.testLine,
    grep: payload.grep,
    // Only a real failed test result is "failed"; a stop with a recorded cause
    // is "stopped"; any other infrastructure or cleanup error is inconclusive,
    // matching the Tests panel's amber banner.
    status: results.some((result) => result.status === "failed")
      ? "failed"
      : stopReason
        ? "stopped"
        : payload.infraError ||
            results.length === 0 ||
            results.some(
              (result) => result.incomplete || result.status === "inconclusive",
            )
          ? "inconclusive"
          : "passed",
    ...(stopReason && { stopReason }),
  };
}

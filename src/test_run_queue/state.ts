import type { TestRunStopReason } from "@/shared/test_run_stop";

export type { TestRunStopReason };

/**
 * One main-owned FIFO per app. Only the active request may acquire test
 * resources; it owns its slot through cleanup and result delivery. Requests
 * from other apps are independent. Nothing here is persisted across restart.
 * Every stop and cancel names its cause, so a stopped run can say why.
 * Dependency graph: test_run_queue -> state_machines (no domain machines).
 */
export interface TestRunRequest {
  readonly runId: number;
  readonly source: "panel" | "agent";
  /** Originating agent chat; panel runs are not associated with a chat. */
  readonly chatId?: number;
  readonly testFile?: string;
  readonly testFiles?: readonly string[];
  readonly testLine?: number;
  readonly grep?: string;
}

export interface TestRunQueueState {
  readonly activeRun:
    | (TestRunRequest & {
        readonly stopping: boolean;
        /** First cause that stopped the active run; set while stopping. */
        readonly stopReason?: TestRunStopReason;
      })
    | null;
  readonly queuedRuns: readonly TestRunRequest[];
}

export const EMPTY_TEST_RUN_QUEUE: TestRunQueueState = {
  activeRun: null,
  queuedRuns: [],
};

export type TestRunQueueEvent =
  | { type: "enqueue"; request: TestRunRequest }
  | { type: "cancel"; runId: number; reason: TestRunStopReason }
  | { type: "stop"; reason: TestRunStopReason }
  | { type: "settled"; runId: number };

export type TestRunQueueCommand =
  | { type: "execute"; runId: number }
  | { type: "abort"; runId: number; reason: TestRunStopReason }
  | { type: "cancel-queued"; runId: number; reason: TestRunStopReason };

export function selectCapabilities(state: TestRunQueueState) {
  return { canStop: state.activeRun !== null || state.queuedRuns.length > 0 };
}

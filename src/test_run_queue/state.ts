/**
 * One main-owned FIFO per app. Only the active request may acquire test
 * resources; it owns its slot through cleanup and result delivery. Requests
 * from other apps are independent. Nothing here is persisted across restart.
 * Dependency graph: test_run_queue -> state_machines (no domain machines).
 */
export interface TestRunRequest {
  readonly runId: number;
  readonly source: "panel" | "agent";
  readonly testFile?: string;
  readonly testLine?: number;
  readonly grep?: string;
}

export interface TestRunQueueState {
  readonly activeRun: (TestRunRequest & { readonly stopping: boolean }) | null;
  readonly queuedRuns: readonly TestRunRequest[];
}

export const EMPTY_TEST_RUN_QUEUE: TestRunQueueState = {
  activeRun: null,
  queuedRuns: [],
};

export type TestRunQueueEvent =
  | { type: "enqueue"; request: TestRunRequest }
  | { type: "cancel"; runId: number }
  | { type: "stop" }
  | { type: "settled"; runId: number };

export type TestRunQueueCommand =
  | { type: "execute"; runId: number }
  | { type: "abort"; runId: number }
  | { type: "cancel-queued"; runId: number };

export function selectCapabilities(state: TestRunQueueState) {
  return { canStop: state.activeRun !== null || state.queuedRuns.length > 0 };
}

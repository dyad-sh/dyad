import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  TestRunQueue,
  type TestRunExecution,
} from "@/test_run_queue/controller";
import {
  EMPTY_TEST_RUN_QUEUE,
  type TestRunRequest,
} from "@/test_run_queue/state";
import { createTraceObserver } from "@/state_machines/trace";
import { broadcastToRegisteredWindows } from "../utils/window_broadcast";
const logger = log.scope("test_run_queue");
const deletingApps = new Set<number>();

// Composition root: the queue knows no IPC, provider, or agent modules.
// Each callback owns the complete lifecycle, including agent result accounting.
const testRunQueues = new Map<number, TestRunQueue>();
const testRunGenerationByAppId = new Map<number, number>();

export function withAppTestRun<Result>(
  options: Omit<TestRunRequest, "runId"> & {
    appId: number;
    event: IpcMainInvokeEvent;
    externalSignal?: AbortSignal;
    onQueued?: (position: number) => void;
  },
  execute: (run: TestRunExecution) => Promise<Result>,
  cancelled: () => Result,
): Promise<Result> {
  const { appId, event } = options;
  if (deletingApps.has(appId))
    return Promise.reject(
      new DyadError("App is being deleted", DyadErrorKind.Precondition),
    );
  const runId = (testRunGenerationByAppId.get(appId) ?? 0) + 1;
  testRunGenerationByAppId.set(appId, runId);
  let queue = testRunQueues.get(appId);
  if (!queue) {
    queue = new TestRunQueue({
      observer: createTraceObserver("test_run_queue", appId),
      onChange: (state) => {
        if (!state.activeRun && testRunQueues.get(appId) === queue)
          testRunQueues.delete(appId);
        broadcastToRegisteredWindows(event.sender, "tests:queue-state", {
          appId,
          ...state,
        });
      },
      onError: (error) =>
        logger.error("Failed to publish test queue state", error),
    });
    testRunQueues.set(appId, queue);
  }
  const result = queue.enqueue({
    request: {
      runId,
      source: options.source,
      testFile: options.testFile,
      testFiles: options.testFiles,
      testLine: options.testLine,
      grep: options.grep,
    },
    signal: options.externalSignal,
    execute,
    cancelled,
    onQueued: options.onQueued,
  });
  if (!queue.getSnapshot().activeRun && testRunQueues.get(appId) === queue)
    testRunQueues.delete(appId);
  return result;
}

export function getAppTestRunQueue(appId: number) {
  return testRunQueues.get(appId)?.getSnapshot() ?? EMPTY_TEST_RUN_QUEUE;
}

export function ownsAppTestRun(appId: number, run: TestRunExecution): boolean {
  return testRunQueues.get(appId)?.ownsExecution(run) ?? false;
}

export function stopAppTestsForApp(appId: number): void {
  testRunQueues.get(appId)?.stop();
}

export function stopAllAppTestRuns(): void {
  for (const queue of testRunQueues.values()) queue.stop();
}

export function drainAppTestRuns(appId: number): Promise<void> {
  return testRunQueues.get(appId)?.drain() ?? Promise.resolve();
}

/**
 * Whether a test run is in flight for the app. Consulted by the recording
 * handler for mutual exclusion — a recording session and a test run must never
 * run at once (both restart the dev server and share the Neon test-branch slot).
 */
export function isTestRunActive(appId: number): boolean {
  return testRunQueues.get(appId)?.getSnapshot().activeRun != null;
}

/** Close test admission before app deletion's first await; drain full callbacks. */
export function beginAppTestDeletion(appId: number) {
  deletingApps.add(appId);
  const queue = testRunQueues.get(appId);
  queue?.stop();
  return {
    drain: () => queue?.drain() ?? Promise.resolve(),
    release: () => {
      deletingApps.delete(appId);
    },
  };
}

import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import {
  TestRunQueue,
  type TestRunExecution,
} from "@/test_run_queue/controller";
import type { TestRunStopReason } from "@/test_run_queue/state";
import { DEFAULT_MAX_CONCURRENT_TEST_RUNS } from "@/shared/settings_defaults";
import type { NeonBranchLimitStatus } from "@/shared/neon_branch_limit";
import type { TestRunQueueSnapshot } from "../types/tests";
import {
  systemClock,
  type Clock,
  type ClockHandle,
} from "@/state_machines/clock";
import { createTraceObserver } from "@/state_machines/trace";
import { broadcastToRegisteredWindows } from "../utils/window_broadcast";
import { TestRunTiming } from "./test_run_timing";
import { trackedE2eTestProcessesForOwner } from "./e2e_test_process_registry";
import {
  loadTestRunContext,
  type TestRunContext,
  type TestRunContextRequest,
} from "./test_run_context";

const logger = log.scope("test_run_queue");
const ADMISSION_RETRY_INTERVAL_MS = 2000;
type RunRecord = {
  request: TestRunContextRequest;
  context?: TestRunContext | null;
  signal?: AbortSignal;
  neonBranchLimit?: { status: NeonBranchLimitStatus; projectId: string };
};

/**
 * One owner arbitrates admission across apps, windows and invocation sources.
 * The queue reserves slots through cleanup and result delivery. Admission uses
 * the current user-configured limit and database/workspace compatibility.
 * Lowering the limit only delays queued work; active runs finish normally.
 */
export function createTestRunQueueService({
  clock = systemClock,
}: {
  clock?: Clock;
} = {}) {
  const deletingApps = new Set<number>();
  const senders = new Map<number, IpcMainInvokeEvent["sender"]>();
  const records = new Map<number, RunRecord>();
  const blockedNeonRuns = new Map<
    number,
    { runId: number; projectId: string }
  >();
  let nextTestRunId = clock.now() * 1000;
  let driving = false;
  let driveTimer: ClockHandle | undefined;
  const unsettledOwners = new Map<AbortSignal, number>();

  function refreshUnsettledOwners() {
    for (const signal of unsettledOwners.keys()) {
      if (!trackedE2eTestProcessesForOwner(signal).length)
        unsettledOwners.delete(signal);
    }
  }

  const queue = new TestRunQueue({
    manualAdmission: true,
    observer: createTraceObserver("test_run_queue", "global"),
    onChange() {
      for (const [appId, sender] of senders) {
        const state = getAppTestRunQueue(appId);
        broadcastToRegisteredWindows(sender, "tests:queue-state", {
          appId,
          ...state,
        });
        if (!state.activeRuns.length && !state.queuedRuns.length)
          senders.delete(appId);
      }
      startSerialRun();
      scheduleDrive();
    },
    onError: (error) =>
      logger.error("Failed to publish test queue state", error),
  });

  function startSerialRun() {
    if (readSettings().enableParallelTestRuns) return;
    refreshUnsettledOwners();
    const state = queue.getSnapshot();
    const busyApps = new Set([
      ...(state.activeRuns ?? []).map((run) => run.appId),
      ...unsettledOwners.values(),
    ]);
    // Preserve the original per-app queue when parallel execution is off.
    for (const run of state.queuedRuns) {
      if (busyApps.has(run.appId)) continue;
      busyApps.add(run.appId);
      const record = records.get(run.runId);
      if (record) record.context = undefined;
      queue.admit(run.runId);
    }
  }

  function scheduleDrive(delay = 0) {
    if (driving) return;
    if (driveTimer !== undefined) clock.cancel(driveTimer);
    driveTimer = undefined;
    const state = queue.getSnapshot();
    if (!state.queuedRuns.length) return;
    driveTimer = clock.schedule(() => {
      driveTimer = undefined;
      void drive();
    }, delay);
    driveTimer.unref?.();
  }

  async function drive() {
    if (driving) return;
    driving = true;
    let admitted = false;
    try {
      startSerialRun();
      const candidate = queue.getSnapshot().queuedRuns[0];
      if (!candidate) return;
      const record = records.get(candidate.runId);
      if (!record) return;
      refreshUnsettledOwners();
      const before = readSettings();
      const activeCount = queue.getSnapshot().activeRuns?.length ?? 0;
      const limitBefore =
        before.maxConcurrentTestRuns ?? DEFAULT_MAX_CONCURRENT_TEST_RUNS;
      // Polling observes settings and late process settlement cheaply. No git
      // or workspace reads are needed when admission is already impossible.
      if (
        unsettledOwners.size ||
        !before.enableParallelTestRuns ||
        activeCount >= limitBefore
      ) {
        queue.waiting(
          candidate.runId,
          unsettledOwners.size
            ? "Waiting for a test process to stop"
            : "Waiting for an active test run to finish",
        );
        return;
      }
      // Capture current branch/config inputs, not consumption predictions.
      record.context = await loadTestRunContext(record.request).catch(
        () => null,
      );
      if (queue.getSnapshot().queuedRuns[0]?.runId !== candidate.runId) return;
      refreshUnsettledOwners();
      const processCleanupBlocked = unsettledOwners.size > 0;
      const active = queue.getSnapshot().activeRuns ?? [];
      const settings = readSettings();
      if (!settings.enableParallelTestRuns) {
        startSerialRun();
        return;
      }
      const limit = settings.enableParallelTestRuns
        ? (settings.maxConcurrentTestRuns ?? DEFAULT_MAX_CONCURRENT_TEST_RUNS)
        : 1;
      const context = record.context;
      const compatible =
        !!context &&
        !context.exclusive &&
        active.every((run) => {
          const other = records.get(run.runId)?.context;
          return (
            other &&
            !other.exclusive &&
            (!context.databaseKey ||
              context.databaseKey !== other.databaseKey ||
              (context.branch === other.branch &&
                context.revision === other.revision))
          );
        });
      const reason = processCleanupBlocked
        ? "Waiting for a test process to stop"
        : active.length >= limit
          ? "Waiting for an active test run to finish"
          : active.length && !compatible
            ? "Waiting for a compatible database and workspace"
            : null;
      if (!reason || candidate.queuedReason !== reason) {
        try {
          logger.info("e2e_test_admission_decision", {
            app_id: candidate.appId,
            run_id: candidate.runId,
            source: candidate.source,
            decision: reason ? "queued" : "admitted",
            reason,
            previous_reason: candidate.queuedReason ?? null,
            active_run_count: active.length,
            active_run_ids: active.map((run) => run.runId),
            parallel_enabled: !!settings.enableParallelTestRuns,
            process_cleanup_blocked: processCleanupBlocked,
            admission: {
              limit,
              compatible,
            },
          });
        } catch {
          // Diagnostics must never prevent queue updates or test execution.
        }
      }
      if (reason) {
        queue.waiting(candidate.runId, reason, context?.branch);
        return;
      }
      queue.waiting(candidate.runId, "Starting", context?.branch);
      queue.admit(candidate.runId);
      admitted = true;
    } catch (error) {
      logger.error("Test admission failed", error);
    } finally {
      driving = false;
      // Fill available slots without waiting for dependency setup.
      scheduleDrive(admitted ? 0 : ADMISSION_RETRY_INTERVAL_MS);
    }
  }

  function withAppTestRun<Result>(
    options: Omit<TestRunContextRequest, "runId"> & {
      event: IpcMainInvokeEvent;
      externalSignal?: AbortSignal;
      onQueued?: (position: number) => void;
    },
    execute: (run: TestRunExecution, timing: TestRunTiming) => Promise<Result>,
    cancelled: (reason: TestRunStopReason) => Result,
  ): Promise<Result> {
    if (deletingApps.has(options.appId))
      return Promise.reject(
        new DyadError("App is being deleted", DyadErrorKind.Precondition),
      );
    if (queue.getSnapshot().queuedRuns.length >= 256)
      return Promise.reject(
        new DyadError(
          "The test queue is full. Wait for a run to finish before adding another.",
          DyadErrorKind.Precondition,
        ),
      );
    const runId = ++nextTestRunId;
    const request: TestRunContextRequest = {
      runId,
      appId: options.appId,
      source: options.source,
      chatId: options.chatId,
      testFile: options.testFile,
      testFiles: options.testFiles,
      testLine: options.testLine,
      grep: options.grep,
      headed: options.headed,
      parallel: options.parallel,
      slowMo: options.slowMo,
      preview: options.preview,
    };
    const record: RunRecord = { request };
    records.set(runId, record);
    senders.set(options.appId, options.event.sender);
    const timing = new TestRunTiming({
      appId: options.appId,
      runId,
      source: options.source,
    });
    const queueWait = timing.startStep("queue_wait");
    return queue
      .enqueue({
        request,
        signal: options.externalSignal,
        onQueued: options.onQueued,
        execute: async (run) => {
          queueWait.end();
          record.signal = run.signal;
          try {
            return await execute(run, timing);
          } finally {
            if (trackedE2eTestProcessesForOwner(run.signal).length)
              unsettledOwners.set(run.signal, options.appId);
          }
        },
        cancelled: (reason) => {
          queueWait.end("cancelled");
          timing.finish("cancelled");
          return cancelled(reason);
        },
      })
      .then(
        (value) => {
          timing.finish(record.signal?.aborted ? "cancelled" : undefined);
          return value;
        },
        (error) => {
          queueWait.end("failed");
          timing.finish(record.signal?.aborted ? "cancelled" : "failed");
          throw error;
        },
      )
      .finally(() => {
        records.delete(runId);
      });
  }

  function getAppTestRunQueue(appId: number): TestRunQueueSnapshot & {
    activeRuns: NonNullable<TestRunQueueSnapshot["activeRuns"]>;
  } {
    const state = queue.getSnapshot();
    const activeRuns = (state.activeRuns ?? [])
      .filter((run) => run.appId === appId)
      .map((run) => ({
        ...run,
        branch: records.get(run.runId)?.context?.branch ?? run.branch,
        waitingForNeonBranch:
          !run.stopping &&
          records.get(run.runId)?.neonBranchLimit?.status === "waiting",
      }));
    const waitingRun = activeRuns.find((run) => run.waitingForNeonBranch);
    const blockedRun = blockedNeonRuns.get(appId);
    return {
      ...(waitingRun
        ? {
            neonBranchLimit: {
              runId: waitingRun.runId,
              projectId: records.get(waitingRun.runId)!.neonBranchLimit!
                .projectId,
              status: "waiting" as const,
            },
          }
        : blockedRun
          ? { neonBranchLimit: { ...blockedRun, status: "blocked" as const } }
          : {}),
      activeRun: activeRuns[0] ?? null,
      activeRuns,
      queuedRuns: state.queuedRuns.filter((run) => run.appId === appId),
    };
  }

  // The queue service owns provider admission notices, so remounting the chat
  // or opening another window can bootstrap the same current explanation.
  function setNeonBranchLimit(
    runId: number,
    projectId: string,
    status: NeonBranchLimitStatus | undefined,
  ) {
    const record = records.get(runId);
    if (!record || record.signal?.aborted) return;
    record.neonBranchLimit = status ? { status, projectId } : undefined;
    const appId = record.request.appId;
    if (status === "blocked") blockedNeonRuns.set(appId, { runId, projectId });
    else if (status === undefined) blockedNeonRuns.delete(appId);
    const sender = senders.get(appId);
    if (sender)
      broadcastToRegisteredWindows(sender, "tests:queue-state", {
        appId,
        ...getAppTestRunQueue(appId),
      });
  }

  /** Called under the source snapshot claim before expensive setup begins. */
  async function validateTestRunInputs(runId: number) {
    const record = records.get(runId);
    if (!record?.context) return;
    const current = await loadTestRunContext(record.request).catch(() => null);
    const others = (queue.getSnapshot().activeRuns ?? []).filter(
      (run) => run.runId !== runId,
    );
    if (
      !current ||
      others.some((run) => {
        const other = records.get(run.runId)?.context;
        return (
          !other ||
          current.exclusive ||
          other.exclusive ||
          (current.databaseKey &&
            current.databaseKey === other.databaseKey &&
            (current.branch !== other.branch ||
              current.revision !== other.revision))
        );
      })
    )
      throw new DyadError(
        "The test database or workspace changed and is no longer compatible with another active run. Run it again after that run finishes.",
        DyadErrorKind.Precondition,
      );
    // Spec edits, lockfile updates and display preferences do not change safe
    // admission. Capture their latest contents under the source snapshot claim.
    record.context = current;
  }

  function dismissNeonBranchLimit(appId: number, runId: number) {
    if (blockedNeonRuns.get(appId)?.runId === runId)
      blockedNeonRuns.delete(appId);
  }

  function ownsAppTestRun(appId: number, run: TestRunExecution) {
    return (
      getAppTestRunQueue(appId).activeRuns.some(
        (active) => active.runId === run.runId,
      ) && queue.ownsExecution(run)
    );
  }
  function cancelAppTestRun(
    appId: number,
    runId: number,
    reason: TestRunStopReason,
  ) {
    const state = getAppTestRunQueue(appId);
    if (
      [...state.activeRuns, ...state.queuedRuns].some(
        (run) => run.runId === runId,
      )
    )
      queue.cancel(runId, reason);
  }
  function stopAppTestsForApp(appId: number, reason: TestRunStopReason) {
    const state = getAppTestRunQueue(appId);
    for (const run of [...state.queuedRuns, ...state.activeRuns])
      queue.cancel(run.runId, reason);
  }
  function stopAllAppTestRuns(reason: TestRunStopReason) {
    queue.stop(reason);
  }
  function drainAppTestRuns(appId: number) {
    return queue.drain(appId);
  }
  function isTestRunActive(appId: number) {
    return getAppTestRunQueue(appId).activeRuns.length > 0;
  }
  function beginAppTestDeletion(appId: number) {
    blockedNeonRuns.delete(appId);
    deletingApps.add(appId);
    stopAppTestsForApp(appId, { kind: "app-deleted" });
    return {
      drain: () => queue.drain(appId),
      release: () => {
        deletingApps.delete(appId);
      },
    };
  }
  return {
    dismissNeonBranchLimit,
    setNeonBranchLimit,
    withAppTestRun,
    getAppTestRunQueue,
    validateTestRunInputs,
    ownsAppTestRun,
    cancelAppTestRun,
    stopAppTestsForApp,
    stopAllAppTestRuns,
    drainAppTestRuns,
    isTestRunActive,
    beginAppTestDeletion,
  };
}

export const {
  dismissNeonBranchLimit,
  setNeonBranchLimit,
  withAppTestRun,
  getAppTestRunQueue,
  validateTestRunInputs,
  ownsAppTestRun,
  cancelAppTestRun,
  stopAppTestsForApp,
  stopAllAppTestRuns,
  drainAppTestRuns,
  isTestRunActive,
  beginAppTestDeletion,
} = createTestRunQueueService();

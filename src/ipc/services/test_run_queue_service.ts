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
import type { TestRunWaitReason } from "@/shared/test_run_queue";
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
const ADMISSION_CONTEXT_REFRESH_INTERVAL_MS = 30_000;
type RunRecord = {
  request: TestRunContextRequest;
  context?: TestRunContext | null;
  contextCheckedAt?: number;
  contextStateKey?: string;
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
  const unsettledOwners = new Map<AbortSignal, RunRecord>();

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
      if (!driving && queue.getSnapshot().queuedRuns.length) startSerialRun();
      scheduleDrive();
    },
    onError: (error) =>
      logger.error("Failed to publish test queue state", error),
  });

  function startSerialRun(settings = readSettings()) {
    if (settings.enableParallelTestRuns) return;
    refreshUnsettledOwners();
    const state = queue.getSnapshot();
    const busyApps = new Set([
      ...(state.activeRuns ?? []).map((run) => run.appId),
      ...[...unsettledOwners.values()].map((owner) => owner.request.appId),
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

  function compatibleWithRun(
    request: TestRunContextRequest,
    context: TestRunContext | null | undefined,
    otherRunId: number,
  ) {
    const other = records.get(otherRunId);
    if (!context || !other?.context) return false;
    const sharedWorkspace =
      request.appId === other.request.appId ||
      context.workspaceKey === other.context.workspaceKey;
    const sharedDatabase =
      !!context.databaseKey &&
      context.databaseKey === other.context.databaseKey;
    if (
      (sharedWorkspace || sharedDatabase) &&
      (context.exclusive || other.context.exclusive)
    )
      return false;
    return (
      !sharedDatabase ||
      (context.branch === other.context.branch &&
        context.revision === other.context.revision)
    );
  }

  function processCleanupBlocks(record: RunRecord) {
    return [...unsettledOwners.values()].some((owner) => {
      if (owner.request.appId === record.request.appId) return true;
      // A surviving process may still touch its workspace or remote database.
      // Retain that context after the queue removes its finished run record.
      const context = record.context;
      const other = owner.context;
      return (
        !context ||
        !other ||
        context.workspaceKey === other.workspaceKey ||
        (!!context.databaseKey && context.databaseKey === other.databaseKey)
      );
    });
  }

  async function drive() {
    if (driving) return;
    driving = true;
    let admitted = false;
    try {
      const settings = readSettings();
      let limit =
        settings.maxConcurrentTestRuns ?? DEFAULT_MAX_CONCURRENT_TEST_RUNS;
      startSerialRun(settings);
      const earlierApps = new Set<number | undefined>();
      const waitingRunIds: number[] = [];
      for (const candidate of queue.getSnapshot().queuedRuns) {
        if (earlierApps.has(candidate.appId)) {
          queue.waiting(candidate.runId, "earlier-run");
          continue;
        }
        earlierApps.add(candidate.appId);
        const record = records.get(candidate.runId);
        if (!record) continue;
        refreshUnsettledOwners();
        const activeCount = queue.getSnapshot().activeRuns?.length ?? 0;
        // Polling observes settings and late process settlement cheaply. No git
        // or workspace reads are needed when admission is already impossible.
        const ownProcessCleanupBlocked = [...unsettledOwners.values()].some(
          (owner) => owner.request.appId === candidate.appId,
        );
        if (ownProcessCleanupBlocked) {
          queue.waiting(candidate.runId, "process-cleanup");
          continue;
        }
        if (
          !settings.enableParallelTestRuns ||
          activeCount + unsettledOwners.size >= limit
        ) {
          queue.waiting(candidate.runId, "capacity");
          return;
        }
        // Reuse admission metadata while resource owners are unchanged. A slow
        // refresh observes branch/config edits; snapshot capture still performs
        // a fresh compatibility check immediately before execution.
        const stateKey = JSON.stringify([
          (queue.getSnapshot().activeRuns ?? []).map((run) => run.runId),
          [...unsettledOwners.values()].map((owner) => owner.request.runId),
        ]);
        if (
          record.contextStateKey !== stateKey ||
          record.contextCheckedAt === undefined ||
          clock.now() - record.contextCheckedAt >=
            ADMISSION_CONTEXT_REFRESH_INTERVAL_MS
        ) {
          try {
            record.context = await loadTestRunContext(record.request, settings);
          } catch (error) {
            record.context = null;
            logger.warn("Failed to load test admission context", {
              appId: candidate.appId,
              runId: candidate.runId,
              error,
            });
          }
          record.contextStateKey = stateKey;
          record.contextCheckedAt = clock.now();
        }
        if (
          !queue
            .getSnapshot()
            .queuedRuns.some((run) => run.runId === candidate.runId)
        )
          continue;
        refreshUnsettledOwners();
        const processCleanupBlocked = processCleanupBlocks(record);
        const active = queue.getSnapshot().activeRuns ?? [];
        const context = record.context;
        const compatible = active.every((run) =>
          compatibleWithRun(record.request, context, run.runId),
        );
        const conflictsWithEarlierRun = waitingRunIds.some(
          (runId) => !compatibleWithRun(record.request, context, runId),
        );
        let reason: TestRunWaitReason | null = !context
          ? "context-unavailable"
          : processCleanupBlocked
            ? "process-cleanup"
            : active.length + unsettledOwners.size >= limit
              ? "capacity"
              : conflictsWithEarlierRun
                ? "earlier-run"
                : active.length && !compatible
                  ? "compatibility"
                  : null;
        if (!reason) {
          // Metadata reads yield to settings changes. Refresh only for a run
          // that can be admitted, not for every blocked candidate or event.
          const latestSettings = readSettings();
          if (!latestSettings.enableParallelTestRuns) {
            startSerialRun(latestSettings);
            return;
          }
          limit =
            latestSettings.maxConcurrentTestRuns ??
            DEFAULT_MAX_CONCURRENT_TEST_RUNS;
          if (active.length + unsettledOwners.size >= limit)
            reason = "capacity";
        }
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
              unsettled_run_count: unsettledOwners.size,
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
          if (reason === "capacity") return;
          if (context) waitingRunIds.push(candidate.runId);
          continue;
        }
        queue.waiting(candidate.runId, "starting", context?.branch);
        queue.admit(candidate.runId);
        admitted = true;
        return;
      }
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
              unsettledOwners.set(run.signal, record);
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
      others.some(
        (run) => !compatibleWithRun(record.request, current, run.runId),
      )
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

import type { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import {
  TestRunQueue,
  type TestRunExecution,
} from "@/test_run_queue/controller";
import {
  INITIAL_TEST_RUN_CONCURRENCY,
  type TestRunResourcePeak,
  type TestRunStopReason,
} from "@/test_run_queue/state";
import {
  accumulateTestRunResourcePeak,
  settleTestRunConcurrency,
  TEST_RUN_RESOURCE_THRESHOLD_PERCENT,
} from "@/test_run_queue/concurrency";
import {
  systemClock,
  type Clock,
  type ClockHandle,
} from "@/state_machines/clock";
import { createTraceObserver } from "@/state_machines/trace";
import { getSystemResourceUsage } from "@/utils/system_resource_usage";
import { broadcastToRegisteredWindows } from "../utils/window_broadcast";
import { TestRunTiming } from "./test_run_timing";
import { trackedE2eTestProcessesForOwner } from "./e2e_test_process_registry";
import {
  loadTestRunContext,
  type TestRunContext,
  type TestRunContextRequest,
} from "./test_run_context";

const logger = log.scope("test_run_queue");
const SAMPLE_INTERVAL_MS = 2000;
type RunRecord = {
  request: TestRunContextRequest;
  context?: TestRunContext | null;
  signal?: AbortSignal;
  startedAt?: number;
  endedAt?: number;
  adaptive: boolean;
  peak: TestRunResourcePeak | null;
};

/**
 * One owner arbitrates admission across apps, windows and invocation sources.
 * The queue reserves slots before execution. This adapter samples system usage
 * and applies the pure concurrency policy synchronously at queue settlement;
 * async measurements never admit work or change the concurrency limit.
 */
export function createTestRunQueueService({
  clock = systemClock,
  sampleResources = getSystemResourceUsage,
}: {
  clock?: Clock;
  sampleResources?: typeof getSystemResourceUsage;
} = {}) {
  const deletingApps = new Set<number>();
  const senders = new Map<number, IpcMainInvokeEvent["sender"]>();
  const records = new Map<number, RunRecord>();
  let nextTestRunId = clock.now() * 1000;
  let concurrency = INITIAL_TEST_RUN_CONCURRENCY;
  let driving = false;
  let driveTimer: ClockHandle | undefined;
  let sampleTimer: ClockHandle | undefined;
  let pendingSample: Promise<void> | undefined;
  let processCleanupBlocked = false;

  const queue = new TestRunQueue({
    manualAdmission: true,
    observer: createTraceObserver("test_run_queue", "global"),
    onSettled(runId) {
      const record = records.get(runId);
      // An admitted run cancelled before execution still belongs to a draining
      // group. Its settlement must release that group's admission fence.
      if (!record?.adaptive && !concurrency.overloadedBatchPeak) return;
      const previous = concurrency;
      const activeCount = queue.getSnapshot().activeRuns!.length;
      const parallelEnabled = !!readSettings().enableParallelTestRuns;
      concurrency = parallelEnabled
        ? settleTestRunConcurrency(
            concurrency,
            activeCount,
            record?.peak ?? null,
          )
        : INITIAL_TEST_RUN_CONCURRENCY;
      const batchPeak = previous.overloadedBatchPeak
        ? record?.peak
          ? accumulateTestRunResourcePeak(
              previous.overloadedBatchPeak,
              record.peak,
            )
          : previous.overloadedBatchPeak
        : concurrency.overloadedBatchPeak;
      try {
        logger.info("e2e_test_concurrency_updated", {
          app_id: record?.request.appId,
          run_id: runId,
          active_run_count: activeCount,
          previous_limit: previous.limit,
          next_limit: concurrency.limit,
          peak_system_cpu_percent: record?.peak?.cpuPercent ?? null,
          peak_system_memory_percent: record?.peak?.memoryPercent ?? null,
          batch_decrease_pending: !!concurrency.overloadedBatchPeak,
          batch_peak_system_cpu_percent: batchPeak?.cpuPercent ?? null,
          batch_peak_system_memory_percent: batchPeak?.memoryPercent ?? null,
          threshold_percent: TEST_RUN_RESOURCE_THRESHOLD_PERCENT,
          parallel_enabled: parallelEnabled,
        });
      } catch {
        // Diagnostics must not interfere with settlement or future admission.
      }
    },
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
      if (!samplingOwners().length && sampleTimer !== undefined) {
        clock.cancel(sampleTimer);
        sampleTimer = undefined;
      }
    },
    onError: (error) =>
      logger.error("Failed to publish test queue state", error),
  });

  function samplingOwners() {
    return [...records.values()].filter(
      (run) =>
        run.adaptive &&
        run.startedAt !== undefined &&
        run.endedAt === undefined,
    );
  }

  function collectSample() {
    if (pendingSample) return pendingSample;
    const owners = samplingOwners();
    if (!owners.length) return Promise.resolve();
    // Capture owners before awaiting. A later run must not inherit a sample
    // requested before it started, including a cached toolbar measurement.
    pendingSample = (async () => {
      try {
        const sample = await sampleResources();
        const now = clock.now();
        if (
          !Number.isFinite(sample.sampledAt) ||
          sample.sampledAt > now ||
          now - sample.sampledAt > 10000
        )
          return;
        const cpu = sample.cpu.usedPercent;
        const { totalBytes, usedBytes, source } = sample.memory;
        const peak: TestRunResourcePeak = {
          cpuPercent:
            cpu !== null && Number.isFinite(cpu) && cpu >= 0 && cpu <= 100
              ? cpu
              : null,
          memoryPercent:
            source !== "fallback" &&
            Number.isFinite(totalBytes) &&
            totalBytes > 0 &&
            Number.isFinite(usedBytes) &&
            usedBytes >= 0 &&
            usedBytes <= totalBytes
              ? (usedBytes / totalBytes) * 100
              : null,
        };
        for (const record of owners) {
          if (
            sample.sampledAt < record.startedAt! ||
            (record.endedAt !== undefined && sample.sampledAt > record.endedAt)
          )
            continue;
          record.peak = accumulateTestRunResourcePeak(record.peak, peak);
        }
      } catch (error) {
        logger.debug("System resource measurements unavailable", error);
      }
    })().finally(() => {
      pendingSample = undefined;
      if (samplingOwners().length && sampleTimer === undefined) {
        sampleTimer = clock.schedule(() => {
          sampleTimer = undefined;
          void collectSample();
        }, SAMPLE_INTERVAL_MS);
        sampleTimer.unref?.();
      }
    });
    return pendingSample;
  }

  function startSerialRun() {
    const state = queue.getSnapshot();
    if (readSettings().enableParallelTestRuns) return;
    concurrency = INITIAL_TEST_RUN_CONCURRENCY;
    if (
      !processCleanupBlocked &&
      !state.activeRuns?.length &&
      state.queuedRuns[0]
    )
      queue.admit(state.queuedRuns[0].runId);
  }

  function scheduleDrive(delay = 0) {
    if (driving) return;
    if (driveTimer !== undefined) clock.cancel(driveTimer);
    driveTimer = undefined;
    const state = queue.getSnapshot();
    if (!state.activeRuns?.length && !state.queuedRuns.length) return;
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
      // Capture current branch/config inputs, not consumption predictions.
      record.context = await loadTestRunContext(record.request).catch(
        () => null,
      );
      if (queue.getSnapshot().queuedRuns[0]?.runId !== candidate.runId) return;
      const active = queue.getSnapshot().activeRuns ?? [];
      const settings = readSettings();
      const limit = settings.enableParallelTestRuns ? concurrency.limit : 1;
      const batchDecreasePending = !!concurrency.overloadedBatchPeak;
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
        ? "A test process could not be stopped. Restart Dyad before starting another run."
        : batchDecreasePending
          ? "Waiting for the active test batch to finish after resource overload"
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
              batch_decrease_pending: batchDecreasePending,
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
      // Fill available slots without waiting for dependency setup or samples.
      scheduleDrive(admitted ? 0 : SAMPLE_INTERVAL_MS);
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
    const record: RunRecord = { request, adaptive: false, peak: null };
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
          record.startedAt = clock.now();
          record.adaptive = !!readSettings().enableParallelTestRuns;
          if (record.adaptive) void collectSample();
          try {
            return await execute(run, timing);
          } finally {
            record.endedAt = clock.now();
            if (trackedE2eTestProcessesForOwner(run.signal).length)
              processCleanupBlocked = true;
            // Retain an in-flight sample taken during the run. Samples timestamped
            // after its end are ignored; no new observation phase delays admission.
            await pendingSample;
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

  function getAppTestRunQueue(appId: number) {
    const state = queue.getSnapshot();
    const activeRuns = (state.activeRuns ?? [])
      .filter((run) => run.appId === appId)
      .map((run) => ({
        ...run,
        branch: records.get(run.runId)?.context?.branch ?? run.branch,
      }));
    return {
      activeRun: activeRuns[0] ?? null,
      activeRuns,
      queuedRuns: state.queuedRuns.filter((run) => run.appId === appId),
    };
  }

  /** Called under the source snapshot claim before expensive setup begins. */
  async function validateTestRunInputs(runId: number) {
    const record = records.get(runId);
    if (!record?.context) return;
    const current = await loadTestRunContext(record.request).catch(() => null);
    if (
      !current ||
      current.inputFingerprint !== record.context.inputFingerprint
    )
      throw new DyadError(
        "The test inputs changed while waiting to capture its workspace. Run it again to use the updated files.",
        DyadErrorKind.Precondition,
      );
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

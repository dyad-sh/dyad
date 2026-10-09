import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import log from "electron-log";
import type { RunAppTestsResult } from "../types/tests";
import { sendTelemetryEvent } from "../utils/telemetry";

const logger = log.scope("test_run_timing");
type StepStatus = "completed" | "failed" | "cancelled" | "timed_out";
type RunStatus =
  | StepStatus
  | "infra_error"
  | "refused"
  | "tests_failed"
  | "not_run";

export type TestStepTiming = Pick<TestRunTiming, "startStep">;
export interface TestCaseTimingResult {
  case_id: string;
  retry: number;
  status: StepStatus | "skipped";
  duration_ms: number;
  setup_ms: number | null;
  execution_ms: number | null;
  cleanup_ms: number | null;
}
interface CaseTiming {
  case_index: number;
  retry?: number;
  result?: TestCaseTimingResult;
  steps: { step: string; duration_ms: number; status: StepStatus }[];
}

// Only these run phases get individual PostHog completions. Other steps can
// repeat per test case (including preview readiness and Playwright processes),
// so keep their detail in local logs and the final aggregate instead of IPC.
const POSTHOG_RUN_STEPS = new Set([
  "queue_wait",
  "workspace_lock_wait",
  "run_lock_wait",
  "recover_previous_environment",
  "playwright_bootstrap",
  "playwright_package_install",
  "playwright_browser_install",
  "workspace_capture",
  "dependency_install",
  "database_isolation",
  "server_start",
  "authorize_runtime_origin",
  "test_discovery",
  "test_execution",
  "lifecycle_drain",
  "preview_disconnect",
  "server_stop",
  "process_settlement",
  "artifact_prune",
  "artifact_retention",
  "database_teardown",
  "workspace_disposal",
]);

/** One explicitly passed timer per run, from queue admission through cleanup. */
export class TestRunTiming {
  private readonly startedAt = performance.now();
  private readonly timingId = randomUUID();
  private nextStepId = 0;
  private finished = false;
  // Agent admission may return before execution (budget, already passed, etc.).
  private status: RunStatus = "not_run";
  private timedOut = false;
  private metadata: Record<string, unknown> = {};
  private readonly stepTimings = new Map<
    string,
    { count: number; total_ms: number; max_ms: number }
  >();
  private readonly cases = new Map<string, CaseTiming>();

  constructor(
    private readonly identity: {
      appId: number;
      runId: number;
      source: "panel" | "agent";
    },
  ) {}

  private properties() {
    return {
      timing_id: this.timingId,
      app_id: this.identity.appId,
      run_id: this.identity.runId,
      source: this.identity.source,
      ...this.metadata,
    };
  }

  private publish(
    event: string,
    properties: Record<string, unknown>,
    sendToPostHog = true,
  ) {
    // Observability must not change queue settlement or mask a test failure.
    try {
      logger.info(event, properties);
      if (sendToPostHog) sendTelemetryEvent(event, properties);
    } catch {
      // The renderer can disappear during shutdown. Local execution continues.
    }
  }

  setFailed() {
    this.status = "infra_error";
  }

  setResult(result: RunAppTestsResult) {
    this.status = result.preflightRefused
      ? "refused"
      : result.infraError
        ? "infra_error"
        : result.results.some((file) => file.status === "failed")
          ? "tests_failed"
          : "completed";
    this.metadata.isolation_mode = result.isolation?.mode ?? "none";
    this.metadata.result_file_count = result.results.length;
    this.metadata.result_case_count = result.results.reduce(
      (count, file) => count + (file.tests?.length ?? 0),
      0,
    );
  }

  setOptions(options: {
    headed?: boolean;
    parallel?: boolean;
    slowMo?: boolean;
    preview?: boolean;
    sandboxed: boolean;
    provider: "supabase" | "neon" | "none";
    runtimeMode: string;
  }) {
    this.metadata = {
      ...this.metadata,
      headed: !!options.headed,
      parallel_requested: !!options.parallel,
      slow_mo: !!options.slowMo,
      preview_requested: !!options.preview,
      sandboxed: options.sandboxed,
      provider: options.provider,
      runtime_mode: options.runtimeMode,
    };
  }

  private caseTiming(caseId: string) {
    let entry = this.cases.get(caseId);
    if (!entry) {
      entry = { case_index: this.cases.size + 1, steps: [] };
      this.cases.set(caseId, entry);
    }
    return entry;
  }

  /** Explicit context for provider hooks; never infer a case from async state. */
  caseSteps(caseId: string): TestStepTiming {
    return { startStep: (step) => this.startStep(step, caseId) };
  }

  recordCaseStarted(caseId: string, retry: number) {
    if (!this.finished) this.caseTiming(caseId).retry = retry;
  }

  recordCaseResult(result: TestCaseTimingResult) {
    if (!this.finished) this.caseTiming(result.case_id).result = result;
  }

  // Use fixed step names, never test titles, paths, SQL, or provider errors.
  startStep(step: string, caseId?: string) {
    if (this.finished) return { stepId: 0, end: (_status?: StepStatus) => {} };
    const stepId = ++this.nextStepId;
    const startedAt = performance.now();
    const properties = {
      ...this.properties(),
      step,
      step_id: stepId,
      started_after_ms: Math.round(startedAt - this.startedAt),
      ...(caseId ? { case_id: caseId } : {}),
    };
    // Local start events identify a phase that never finishes (hang/crash).
    this.publish("e2e_test_step_started", properties, false);
    let ended = false;
    return {
      stepId,
      end: (status: StepStatus = "completed") => {
        if (ended || this.finished) return;
        ended = true;
        if (status === "timed_out") this.timedOut = true;
        const durationMs = Math.round(performance.now() - startedAt);
        if (caseId) {
          this.caseTiming(caseId).steps.push({
            step,
            duration_ms: durationMs,
            status,
          });
        }
        const previous = this.stepTimings.get(step);
        this.stepTimings.set(step, {
          count: (previous?.count ?? 0) + 1,
          total_ms: (previous?.total_ms ?? 0) + durationMs,
          max_ms: Math.max(previous?.max_ms ?? 0, durationMs),
        });
        this.publish(
          "e2e_test_step_completed",
          { ...properties, duration_ms: durationMs, status },
          // Even an accidentally repeated run phase must not flood telemetry.
          !caseId && POSTHOG_RUN_STEPS.has(step) && !previous,
        );
      },
    };
  }

  finish(status?: RunStatus) {
    if (this.finished) return;
    this.finished = true;
    // Wait until run cleanup has drained so abandoned attempts include their
    // final provider cleanup too. Reporter results cover parallel/no-DB cases.
    for (const [caseId, entry] of this.cases) {
      const hookFailure = entry.steps.find(
        (step) => step.status !== "completed",
      );
      this.publish("e2e_test_case_completed", {
        ...this.properties(),
        case_id: caseId,
        case_index: entry.case_index,
        retry: entry.retry ?? null,
        duration_ms: null,
        setup_ms: null,
        execution_ms: null,
        cleanup_ms: null,
        ...entry.result,
        status:
          hookFailure?.status ??
          entry.result?.status ??
          (status === "cancelled" ? "cancelled" : "incomplete"),
        timing_incomplete:
          !entry.result ||
          entry.result.setup_ms === null ||
          entry.result.execution_ms === null ||
          entry.result.cleanup_ms === null,
        // Keep each invocation, including setup recovery and cleanup retries.
        steps: entry.steps,
      });
    }
    this.cases.clear();
    this.publish("e2e_test_run_completed", {
      ...this.properties(),
      status:
        status === "cancelled"
          ? "cancelled"
          : this.timedOut
            ? "timed_out"
            : (status ?? this.status),
      duration_ms: Math.round(performance.now() - this.startedAt),
      // Durations are inclusive: nested phases must not be added together.
      step_timings: Object.fromEntries(this.stepTimings),
    });
  }
}

export function testProcessTimingStatus(result: {
  aborted: boolean;
  timedOut: boolean;
  code: number | null;
}): StepStatus {
  return result.aborted
    ? "cancelled"
    : result.timedOut
      ? "timed_out"
      : result.code === 0
        ? "completed"
        : "failed";
}

export async function measureTestRunStep<T>(
  timing: TestStepTiming | undefined,
  step: string,
  action: () => Promise<T>,
  statusOf?: (value: T) => StepStatus,
): Promise<T> {
  if (!timing) return action();
  const span = timing.startStep(step);
  let status: StepStatus = "failed";
  try {
    const result = await action();
    status = statusOf?.(result) ?? "completed";
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      status = "cancelled";
    if (error instanceof Error && error.name === "TimeoutError")
      status = "timed_out";
    throw error;
  } finally {
    span.end(status);
  }
}

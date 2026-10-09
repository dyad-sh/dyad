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

  private publish(event: string, properties: Record<string, unknown>) {
    // Observability must not change queue settlement or mask a test failure.
    try {
      logger.info(event, properties);
      sendTelemetryEvent(event, properties);
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

  // Use fixed step names, never test titles, paths, SQL, or provider errors.
  startStep(step: string) {
    if (this.finished) return { stepId: 0, end: (_status?: StepStatus) => {} };
    const stepId = ++this.nextStepId;
    const startedAt = performance.now();
    const properties = {
      ...this.properties(),
      step,
      step_id: stepId,
      started_after_ms: Math.round(startedAt - this.startedAt),
    };
    // Start events also identify a phase that never finishes (hang/crash).
    this.publish("e2e_test_step_started", properties);
    let ended = false;
    return {
      stepId,
      end: (status: StepStatus = "completed") => {
        if (ended || this.finished) return;
        ended = true;
        if (status === "timed_out") this.timedOut = true;
        const durationMs = Math.round(performance.now() - startedAt);
        this.publish("e2e_test_step_completed", {
          ...properties,
          duration_ms: durationMs,
          status,
        });
      },
    };
  }

  finish(status?: RunStatus) {
    if (this.finished) return;
    this.finished = true;
    this.publish("e2e_test_run_completed", {
      ...this.properties(),
      status:
        status === "cancelled"
          ? "cancelled"
          : this.timedOut
            ? "timed_out"
            : (status ?? this.status),
      duration_ms: Math.round(performance.now() - this.startedAt),
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
  timing: TestRunTiming | undefined,
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

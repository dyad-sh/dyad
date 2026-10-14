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

type CaseStatus = StepStatus | "skipped" | "incomplete";
const CASE_PHASES = ["setup", "execution", "cleanup"] as const;
const RUN_STEP_GROUPS = {
  waiting: ["queue_wait", "workspace_lock_wait", "run_lock_wait"],
  recovery: ["recover_previous_environment"],
  playwright_setup: [
    "playwright_bootstrap",
    "playwright_package_install",
    "playwright_browser_install",
  ],
  workspace_setup: ["workspace_capture", "dependency_install"],
  database_setup: [
    "database_isolation",
    "neon_branch_create",
    "neon_environment_update",
    "neon_cleaner_setup",
    "neon_user_create",
    "supabase_rls_check",
    "supabase_key_detection",
    "supabase_admin_key",
    "supabase_publishable_key",
    "supabase_user_create",
  ],
  runtime_setup: ["server_start", "authorize_runtime_origin"],
  preview_setup: ["preview_ready", "preview_connect"],
  discovery: ["test_discovery"],
  execution: ["test_execution", "playwright_process", "preview_rotate"],
  shutdown: [
    "lifecycle_drain",
    "preview_disconnect",
    "server_stop",
    "process_settlement",
  ],
  cleanup: [
    "artifact_prune",
    "artifact_retention",
    "database_teardown",
    "workspace_disposal",
    "neon_branch_delete",
    "supabase_user_cleanup",
    "supabase_row_cleanup",
    "supabase_user_delete",
  ],
} as const;
type RunStepGroup = keyof typeof RUN_STEP_GROUPS;
const runStepGroups = new Map<string, RunStepGroup>(
  (Object.keys(RUN_STEP_GROUPS) as RunStepGroup[]).flatMap((group) =>
    RUN_STEP_GROUPS[group].map((step) => [step, group] as const),
  ),
);
// The broad execution timer encloses discovery and other phases. Attribute
// overlapping time once, to the more specific phase. Cleanup/shutdown take
// precedence when draining concurrently with other work. Nested steps in one
// group count once; testcase phases remain scoped to their individual attempt.
const RUN_GROUP_PRIORITY: RunStepGroup[] = [
  "cleanup",
  "shutdown",
  "discovery",
  "waiting",
  "recovery",
  "workspace_setup",
  "playwright_setup",
  "database_setup",
  "runtime_setup",
  "preview_setup",
  "execution",
];

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
  private lastRunStepUpdate = this.startedAt;
  private readonly activeRunGroups = new Map<RunStepGroup, number>();
  private readonly runGroupDurations = new Map<RunStepGroup, number>();
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
    sendToPostHog = false,
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

  private updateRunGroupDuration(now: number) {
    const group = RUN_GROUP_PRIORITY.find(
      (candidate) => (this.activeRunGroups.get(candidate) ?? 0) > 0,
    );
    if (group) {
      this.runGroupDurations.set(
        group,
        (this.runGroupDurations.get(group) ?? 0) + now - this.lastRunStepUpdate,
      );
    }
    this.lastRunStepUpdate = now;
  }

  // Use fixed step names, never test titles, paths, SQL, or provider errors.
  startStep(step: string, caseId?: string) {
    if (this.finished) return { stepId: 0, end: (_status?: StepStatus) => {} };
    const stepId = ++this.nextStepId;
    const startedAt = performance.now();
    // Case hooks belong only to their attempt. Provider detail without its own
    // group (e.g. neon_data_cleanup during setup or teardown) is covered by the
    // enclosing run phase. Unknown step names stay in local logs.
    const group = caseId ? undefined : runStepGroups.get(step);
    if (group) {
      this.updateRunGroupDuration(startedAt);
      this.activeRunGroups.set(
        group,
        (this.activeRunGroups.get(group) ?? 0) + 1,
      );
      if (!this.runGroupDurations.has(group))
        this.runGroupDurations.set(group, 0);
    }
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
        const endedAt = performance.now();
        const durationMs = Math.round(endedAt - startedAt);
        if (group) {
          this.updateRunGroupDuration(endedAt);
          this.activeRunGroups.set(group, this.activeRunGroups.get(group)! - 1);
        }
        if (caseId) {
          this.caseTiming(caseId).steps.push({
            step,
            duration_ms: durationMs,
            status,
          });
        }
        this.publish(
          "e2e_test_step_completed",
          { ...properties, duration_ms: durationMs, status },
          false,
        );
      },
    };
  }

  finish(status?: RunStatus) {
    if (this.finished) return;
    const finishedAt = performance.now();
    this.updateRunGroupDuration(finishedAt);
    this.finished = true;
    // Wait until run cleanup has drained so abandoned attempts include their
    // final provider cleanup too. Reporter results cover parallel/no-DB cases.
    const testcases = [];
    for (const [caseId, entry] of this.cases) {
      const hookFailure = entry.steps.find(
        (step) => step.status !== "completed",
      );
      const caseStatus: CaseStatus =
        hookFailure?.status ??
        entry.result?.status ??
        (status === "cancelled" ? "cancelled" : "incomplete");
      const timingIncomplete =
        !entry.result ||
        entry.result.setup_ms === null ||
        entry.result.execution_ms === null ||
        entry.result.cleanup_ms === null;
      const retry = entry.result?.retry ?? entry.retry;
      testcases.push({
        case_id: caseId,
        case_index: entry.case_index,
        retry: retry ?? null,
        status: caseStatus,
        duration_ms: entry.result?.duration_ms ?? null,
        timing_incomplete: timingIncomplete,
        // Reporter hook spans already include provider work and user fixtures.
        // Missing phase timings stay null; nested provider spans cannot replace
        // a complete hook span or be added to it without double counting.
        steps: CASE_PHASES.map((step) => ({
          step,
          duration_ms: entry.result?.[`${step}_ms`] ?? null,
        })),
      });
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
        status: caseStatus,
        timing_incomplete: timingIncomplete,
        // Keep each invocation, including setup recovery and cleanup retries.
        steps: entry.steps,
      });
    }
    this.cases.clear();
    this.publish(
      "e2e_test_run_completed",
      {
        ...this.properties(),
        schema_version: 2,
        status:
          status === "cancelled"
            ? "cancelled"
            : this.timedOut
              ? "timed_out"
              : (status ?? this.status),
        duration_ms: Math.round(finishedAt - this.startedAt),
        // Disjoint, instrumented wall-clock time. Uninstrumented gaps are not
        // assigned to a group. Testcase times overlap this run-level breakdown.
        run_steps: (Object.keys(RUN_STEP_GROUPS) as RunStepGroup[])
          .filter((step) => this.runGroupDurations.has(step))
          .map((step) => ({
            step,
            duration_ms: Math.round(this.runGroupDurations.get(step)!),
          })),
        testcases,
      },
      true,
    );
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

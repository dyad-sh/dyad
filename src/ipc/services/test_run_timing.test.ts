import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import {
  measureTestRunStep,
  testProcessTimingStatus,
  TestRunTiming,
} from "./test_run_timing";
import { sendTelemetryEvent } from "../utils/telemetry";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("electron-log", () => ({ default: { scope: () => ({ info }) } }));
vi.mock("../utils/telemetry", () => ({ sendTelemetryEvent: vi.fn() }));
let now = 0;
beforeEach(() => {
  vi.resetAllMocks();
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());
function timing(runId = 1) {
  return new TestRunTiming({ appId: 123, runId, source: "panel" });
}
function events(name: string) {
  return vi
    .mocked(sendTelemetryEvent)
    .mock.calls.filter(([event]) => event === name)
    .map(([, properties]) => properties!);
}
function logEvents(name: string) {
  return info.mock.calls
    .filter(([event]) => event === name)
    .map(([, properties]) => properties);
}

it("logs every step and sends only the run summary through cleanup", async () => {
  const run = timing();
  const wait = run.startStep("queue_wait");
  now = 30;
  wait.end();
  wait.end("failed");
  for (let i = 0; i < 2; i++) {
    await measureTestRunStep(run, "case_setup", async () => {
      now += 50;
    });
  }
  await measureTestRunStep(run, "database_teardown", async () => {
    now += 20;
  });
  run.setResult({
    appId: 123,
    results: [],
    isolation: { mode: "neon-branch" },
  });
  run.finish();
  run.finish();
  const completed = logEvents("e2e_test_step_completed");
  expect(completed.map(({ step, duration_ms }) => [step, duration_ms])).toEqual(
    [
      ["queue_wait", 30],
      ["case_setup", 50],
      ["case_setup", 50],
      ["database_teardown", 20],
    ],
  );
  expect(new Set(completed.map(({ step_id }) => step_id)).size).toBe(4);
  expect(new Set(completed.map(({ timing_id }) => timing_id)).size).toBe(1);
  expect(
    logEvents("e2e_test_step_started").map(({ step_id }) => step_id),
  ).toEqual(completed.map(({ step_id }) => step_id));
  expect(events("e2e_test_run_completed")).toEqual([
    expect.objectContaining({
      duration_ms: 150,
      status: "completed",
      isolation_mode: "neon-branch",
      step_timings: {
        queue_wait: { count: 1, total_ms: 30, max_ms: 30 },
        case_setup: { count: 2, total_ms: 100, max_ms: 50 },
        database_teardown: { count: 1, total_ms: 20, max_ms: 20 },
      },
    }),
  ]);
  expect(events("e2e_test_step_started")).toEqual([]);
  expect(events("e2e_test_step_completed")).toEqual([]);
  expect(sendTelemetryEvent).toHaveBeenCalledTimes(1);
  expect(logEvents("e2e_test_run_completed")).toEqual(
    events("e2e_test_run_completed"),
  );
});

it("batches 100 cases and repeated provider steps into one fixed-size run summary", async () => {
  const run = timing();
  const repeatedSteps = [
    "case_setup",
    "case_cleanup",
    "supabase_user_create",
    "supabase_user_cleanup",
    "supabase_row_cleanup",
    "supabase_user_delete",
    "neon_data_cleanup",
    "neon_user_create",
    "preview_rotate",
    "preview_ready",
    "preview_connect",
    "playwright_process",
    "future_case_step",
  ];
  await measureTestRunStep(run, "test_execution", async () => {
    for (let i = 0; i < 100; i++) {
      const caseId = `case-${i}`;
      const caseTiming = run.caseSteps(caseId);
      const duration = i % 2 === 0 ? 5 : 15;
      for (const step of repeatedSteps) {
        await measureTestRunStep(caseTiming, step, async () => {
          now += duration;
        });
      }
      run.recordCaseResult({
        case_id: caseId,
        retry: 0,
        status: "completed",
        duration_ms: 13 * duration,
        setup_ms: 2 * duration,
        execution_ms: 9 * duration,
        cleanup_ms: 2 * duration,
      });
    }
  });
  run.finish();

  expect(sendTelemetryEvent).toHaveBeenCalledTimes(1);
  expect(events("e2e_test_case_completed")).toEqual([]);
  expect(events("e2e_test_step_completed")).toEqual([]);
  expect(events("e2e_test_run_completed")[0].case_summary).toEqual({
    attempt_count: 100,
    retry_count: 0,
    unknown_retry_count: 0,
    incomplete_timing_count: 0,
    outcomes: {
      completed: 100,
      failed: 0,
      cancelled: 0,
      timed_out: 0,
      skipped: 0,
      incomplete: 0,
    },
    timings: {
      duration_ms: {
        count: 100,
        total_ms: 13000,
        average_ms: 130,
        max_ms: 195,
      },
      setup_ms: { count: 100, total_ms: 2000, average_ms: 20, max_ms: 30 },
      execution_ms: { count: 100, total_ms: 9000, average_ms: 90, max_ms: 135 },
      cleanup_ms: { count: 100, total_ms: 2000, average_ms: 20, max_ms: 30 },
    },
  });
  expect(JSON.stringify(events("e2e_test_run_completed"))).not.toContain(
    "case-99",
  );
  const cases = logEvents("e2e_test_case_completed");
  for (let i = 0; i < cases.length; i++) {
    const duration = i % 2 === 0 ? 5 : 15;
    expect(cases[i]).toMatchObject({
      case_id: `case-${i}`,
      case_index: i + 1,
      status: "completed",
      timing_incomplete: false,
      steps: repeatedSteps.map((step) => ({
        step,
        duration_ms: duration,
        status: "completed",
      })),
    });
  }
  expect(logEvents("e2e_test_step_completed").at(-1)).toMatchObject({
    step: "test_execution",
    duration_ms: 13000,
  });
  expect(events("e2e_test_run_completed")[0].step_timings).toEqual({
    ...Object.fromEntries(
      repeatedSteps.map((step) => [
        step,
        { count: 100, total_ms: 1000, max_ms: 15 },
      ]),
    ),
    test_execution: { count: 1, total_ms: 13000, max_ms: 13000 },
  });
  expect(logEvents("e2e_test_step_started")).toHaveLength(1301);
  expect(logEvents("e2e_test_step_completed")).toHaveLength(1301);
});

it("preserves abandoned-case cleanup and marks missing execution timing explicitly", async () => {
  const run = timing();
  run.recordCaseStarted("abandoned", 0);
  const caseTiming = run.caseSteps("abandoned");
  await measureTestRunStep(caseTiming, "case_setup", async () => {
    now += 10;
  });
  await measureTestRunStep(caseTiming, "case_cleanup", async () => {
    now += 30;
  });
  run.finish("cancelled");
  run.finish("cancelled");
  expect(logEvents("e2e_test_case_completed")).toEqual([
    expect.objectContaining({
      case_id: "abandoned",
      retry: 0,
      status: "cancelled",
      timing_incomplete: true,
      execution_ms: null,
      steps: [
        { step: "case_setup", duration_ms: 10, status: "completed" },
        { step: "case_cleanup", duration_ms: 30, status: "completed" },
      ],
    }),
  ]);
});

it("sends only the summary while aggregating every repeated run phase", async () => {
  const run = timing();
  for (let i = 0; i < 100; i++) {
    await measureTestRunStep(run, "playwright_bootstrap", async () => {
      now += 10;
    });
  }
  run.finish();
  expect(events("e2e_test_step_completed")).toHaveLength(0);
  expect(sendTelemetryEvent).toHaveBeenCalledTimes(1);
  expect(events("e2e_test_run_completed")[0].step_timings).toEqual({
    playwright_bootstrap: { count: 100, total_ms: 1000, max_ms: 10 },
  });
});

it("preserves failures and return values without sending their contents", async () => {
  const run = timing();
  const error = new Error("secret password, SQL, and private provider URL");
  await expect(
    measureTestRunStep(run, "supabase_user_create", async () => {
      now = 42;
      throw error;
    }),
  ).rejects.toBe(error);
  const credentials = { password: "private-password" };
  expect(
    await measureTestRunStep(run, "case_setup", async () => credentials),
  ).toBe(credentials);
  run.setResult({
    appId: 123,
    results: [],
    infraError: { message: error.message },
  });
  run.finish();
  expect(logEvents("e2e_test_step_completed")[0]).toMatchObject({
    status: "failed",
    duration_ms: 42,
  });
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    status: "infra_error",
    step_timings: {
      supabase_user_create: { count: 1, total_ms: 42, max_ms: 42 },
      case_setup: { count: 1, total_ms: 0, max_ms: 0 },
    },
  });
  const payload = JSON.stringify(vi.mocked(sendTelemetryEvent).mock.calls);
  expect(payload).not.toContain(error.message);
  expect(payload).not.toContain("private-password");
});

it("aggregates retries and outcomes without treating missing phase timings as zero", async () => {
  const run = timing();
  run.recordCaseResult({
    case_id: "failed-first-attempt",
    retry: 0,
    status: "failed",
    duration_ms: 30,
    setup_ms: 10,
    execution_ms: 20,
    cleanup_ms: null,
  });
  run.recordCaseResult({
    case_id: "successful-retry",
    retry: 1,
    status: "completed",
    duration_ms: 60,
    setup_ms: 20,
    execution_ms: 30,
    cleanup_ms: 10,
  });
  run.recordCaseResult({
    case_id: "skipped",
    retry: 0,
    status: "skipped",
    duration_ms: 0,
    setup_ms: 0,
    execution_ms: 0,
    cleanup_ms: 0,
  });
  run.recordCaseStarted("interrupted-retry", 2);
  await measureTestRunStep(
    run.caseSteps("cleanup-failure"),
    "case_cleanup",
    async () => false,
    (ok) => (ok ? "completed" : "failed"),
  );
  run.finish("cancelled");
  run.finish();
  expect(sendTelemetryEvent).toHaveBeenCalledTimes(1);
  expect(events("e2e_test_run_completed")[0].case_summary).toEqual({
    attempt_count: 5,
    retry_count: 2,
    unknown_retry_count: 1,
    incomplete_timing_count: 3,
    outcomes: {
      completed: 1,
      failed: 2,
      cancelled: 1,
      timed_out: 0,
      skipped: 1,
      incomplete: 0,
    },
    timings: {
      duration_ms: { count: 3, total_ms: 90, average_ms: 30, max_ms: 60 },
      setup_ms: { count: 3, total_ms: 30, average_ms: 10, max_ms: 20 },
      execution_ms: { count: 3, total_ms: 50, average_ms: 50 / 3, max_ms: 30 },
      cleanup_ms: { count: 2, total_ms: 10, average_ms: 5, max_ms: 10 },
    },
  });
  expect(
    JSON.stringify(vi.mocked(sendTelemetryEvent).mock.calls),
  ).not.toContain("successful-retry");
});

it("reports empty timing aggregates explicitly for runs with no cases", () => {
  timing().finish();
  expect(events("e2e_test_run_completed")[0].case_summary).toMatchObject({
    attempt_count: 0,
    retry_count: 0,
    incomplete_timing_count: 0,
    timings: {
      setup_ms: { count: 0, total_ms: 0, average_ms: null, max_ms: null },
      execution_ms: { count: 0, total_ms: 0, average_ms: null, max_ms: null },
      cleanup_ms: { count: 0, total_ms: 0, average_ms: null, max_ms: null },
    },
  });
});

it("keeps concurrent runs separate through explicit timer arguments", async () => {
  const first = timing(1);
  const second = timing(2);
  const callback = () =>
    measureTestRunStep(first, "case_setup", async () => {
      await Promise.resolve();
    });
  await Promise.all([
    callback(),
    measureTestRunStep(second, "database_isolation", async () => {
      await Promise.resolve();
    }),
  ]);
  const completed = logEvents("e2e_test_step_completed");
  expect(completed.find(({ step }) => step === "case_setup")).toMatchObject({
    run_id: 1,
  });
  expect(
    completed.find(({ step }) => step === "database_isolation"),
  ).toMatchObject({ run_id: 2 });
  expect(new Set(completed.map(({ timing_id }) => timing_id)).size).toBe(2);
  first.finish();
  second.finish();
  expect(
    events("e2e_test_run_completed").map(({ step_timings }) => step_timings),
  ).toEqual([
    { case_setup: { count: 1, total_ms: 0, max_ms: 0 } },
    { database_isolation: { count: 1, total_ms: 0, max_ms: 0 } },
  ]);
});

it("records resolved failures and includes cleanup in cancelled runs", async () => {
  const run = timing();
  await measureTestRunStep(
    run,
    "database_teardown",
    async () => false,
    (ok) => (ok ? "completed" : "failed"),
  );
  await measureTestRunStep(run, "workspace_disposal", async () => {
    now += 100;
  });
  run.finish("cancelled");
  expect(logEvents("e2e_test_step_completed")[0]).toMatchObject({
    status: "failed",
  });
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    status: "cancelled",
    duration_ms: 100,
    step_timings: {
      database_teardown: { count: 1, total_ms: 0, max_ms: 0 },
      workspace_disposal: { count: 1, total_ms: 100, max_ms: 100 },
    },
  });
});

it("does not instrument callers that omit timing", async () => {
  expect(
    await measureTestRunStep(
      undefined,
      "supabase_user_delete",
      async () => true,
    ),
  ).toBe(true);
  expect(sendTelemetryEvent).not.toHaveBeenCalled();
});

it("reports timeouts and ignores timing calls after completion", async () => {
  const run = timing();
  await measureTestRunStep(
    run,
    "playwright_process",
    async () => ({ aborted: false, timedOut: true, code: null }),
    testProcessTimingStatus,
  );
  await expect(
    measureTestRunStep(run, "case_setup", async () => {
      throw Object.assign(new Error("provider timed out"), {
        name: "TimeoutError",
      });
    }),
  ).rejects.toThrow("provider timed out");
  run.finish();
  await measureTestRunStep(run, "supabase_user_delete", async () => true);
  expect(
    logEvents("e2e_test_step_completed").map(({ status }) => status),
  ).toEqual(["timed_out", "timed_out"]);
  expect(logEvents("e2e_test_step_started")).toHaveLength(2);
  expect(events("e2e_test_step_started")).toEqual([]);
  expect(events("e2e_test_step_completed")).toEqual([]);
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    status: "timed_out",
    step_timings: {
      playwright_process: { count: 1, total_ms: 0, max_ms: 0 },
      case_setup: { count: 1, total_ms: 0, max_ms: 0 },
    },
  });
});

it("does not report preflight or a caught infrastructure error as a completed run", () => {
  timing().finish();
  const failed = timing(2);
  failed.setFailed();
  failed.finish();
  expect(events("e2e_test_run_completed").map(({ status }) => status)).toEqual([
    "not_run",
    "infra_error",
  ]);
});

it("does not let telemetry failures break execution or replace the original error", async () => {
  vi.mocked(sendTelemetryEvent).mockImplementation(() => {
    throw new Error("renderer closed");
  });
  const error = new Error("original failure");
  const run = timing();
  expect(await measureTestRunStep(run, "server_start", async () => 7)).toBe(7);
  await expect(
    measureTestRunStep(run, "database_teardown", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(() => run.finish()).not.toThrow();
});

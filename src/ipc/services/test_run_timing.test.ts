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
    await measureTestRunStep(run, "workspace_capture", async () => {
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
      ["workspace_capture", 50],
      ["workspace_capture", 50],
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
      schema_version: 2,
      run_steps: [
        { step: "waiting", duration_ms: 30 },
        { step: "workspace_setup", duration_ms: 100 },
        { step: "cleanup", duration_ms: 20 },
      ],
      testcases: [],
    }),
  ]);
  expect(events("e2e_test_step_started")).toEqual([]);
  expect(events("e2e_test_step_completed")).toEqual([]);
  expect(sendTelemetryEvent).toHaveBeenCalledTimes(1);
  expect(logEvents("e2e_test_run_completed")).toEqual(
    events("e2e_test_run_completed"),
  );
});

it("batches 100 individual cases with grouped timings into one run event", async () => {
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
  const summary = events("e2e_test_run_completed")[0];
  expect(summary.testcases).toEqual(
    Array.from({ length: 100 }, (_, i) => {
      const duration = i % 2 === 0 ? 5 : 15;
      return {
        case_id: `case-${i}`,
        case_index: i + 1,
        retry: 0,
        status: "completed",
        duration_ms: 13 * duration,
        timing_incomplete: false,
        steps: [
          { step: "setup", duration_ms: 2 * duration },
          { step: "execution", duration_ms: 9 * duration },
          { step: "cleanup", duration_ms: 2 * duration },
        ],
      };
    }),
  );
  expect(summary).not.toHaveProperty("case_summary");
  expect(summary).not.toHaveProperty("step_timings");
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
  expect(summary.run_steps).toEqual([
    { step: "execution", duration_ms: 13000 },
  ]);
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
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    run_steps: [],
    testcases: [
      {
        case_id: "abandoned",
        retry: 0,
        status: "cancelled",
        duration_ms: null,
        timing_incomplete: true,
        steps: [
          { step: "setup", duration_ms: null },
          { step: "execution", duration_ms: null },
          { step: "cleanup", duration_ms: null },
        ],
      },
    ],
  });
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
  expect(events("e2e_test_run_completed")[0].run_steps).toEqual([
    { step: "playwright_setup", duration_ms: 1000 },
  ]);
});

it("keeps workspace setup and every other run area independently measurable", async () => {
  const run = timing();
  const steps: [string, number][] = [
    ["workspace_lock_wait", 10],
    ["recover_previous_environment", 15],
    ["playwright_bootstrap", 30],
    ["workspace_capture", 20],
    ["database_isolation", 40],
    ["dependency_install", 50],
    ["server_start", 60],
    ["preview_ready", 25],
    ["preview_connect", 5],
    ["test_discovery", 10],
    ["test_execution", 90],
    ["server_stop", 20],
    ["process_settlement", 10],
    ["database_teardown", 40],
    ["workspace_disposal", 5],
  ];
  for (const [step, duration] of steps) {
    await measureTestRunStep(run, step, async () => {
      now += duration;
    });
  }
  run.finish();
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    duration_ms: 430,
    run_steps: [
      { step: "waiting", duration_ms: 10 },
      { step: "recovery", duration_ms: 15 },
      { step: "playwright_setup", duration_ms: 30 },
      { step: "workspace_setup", duration_ms: 70 },
      { step: "database_setup", duration_ms: 40 },
      { step: "runtime_setup", duration_ms: 60 },
      { step: "preview_setup", duration_ms: 30 },
      { step: "discovery", duration_ms: 10 },
      { step: "execution", duration_ms: 90 },
      { step: "shutdown", duration_ms: 30 },
      { step: "cleanup", duration_ms: 45 },
    ],
  });
});

it("groups enclosing timers without double counting nested phases or idle gaps", () => {
  const run = timing();
  const queue = run.startStep("queue_wait");
  now = 10;
  queue.end();
  const bootstrap = run.startStep("playwright_bootstrap");
  now = 20;
  const install = run.startStep("playwright_package_install");
  now = 35;
  install.end();
  const browser = run.startStep("playwright_browser_install");
  now = 40;
  browser.end();
  now = 50;
  bootstrap.end();
  now = 60;
  const execution = run.startStep("test_execution");
  const process = run.startStep("playwright_process");
  now = 70;
  const discovery = run.startStep("test_discovery");
  now = 90;
  discovery.end();
  const ready = run.startStep("preview_ready");
  now = 100;
  ready.end();
  now = 140;
  const drain = run.startStep("lifecycle_drain");
  now = 150;
  process.end();
  execution.end();
  now = 155;
  const prune = run.startStep("artifact_prune");
  now = 165;
  prune.end();
  now = 170;
  drain.end();
  now = 180;
  run.finish();
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    duration_ms: 180,
    run_steps: [
      { step: "waiting", duration_ms: 10 },
      { step: "playwright_setup", duration_ms: 40 },
      { step: "preview_setup", duration_ms: 10 },
      { step: "discovery", duration_ms: 20 },
      { step: "execution", duration_ms: 50 },
      { step: "shutdown", duration_ms: 20 },
      { step: "cleanup", duration_ms: 10 },
    ],
  });
});

it("counts overlapping steps in a group once and retains unfinished time on cancellation", () => {
  const run = timing();
  const first = run.startStep("preview_connect");
  now = 10;
  const second = run.startStep("preview_connect");
  now = 20;
  first.end();
  now = 30;
  run.finish("cancelled");
  now = 40;
  second.end();
  run.finish();
  expect(events("e2e_test_run_completed")).toEqual([
    expect.objectContaining({
      status: "cancelled",
      duration_ms: 30,
      run_steps: [{ step: "preview_setup", duration_ms: 30 }],
    }),
  ]);
});

it("keeps unmapped step names local and rounds grouped durations only once", () => {
  const run = timing();
  const unknown = run.startStep("unknown-private-step");
  now = 10;
  unknown.end();
  for (let i = 0; i < 10; i++) {
    const step = run.startStep("server_start");
    now += 0.4;
    step.end();
  }
  run.finish();
  expect(events("e2e_test_run_completed")[0].run_steps).toEqual([
    { step: "runtime_setup", duration_ms: 4 },
  ]);
  expect(
    JSON.stringify(vi.mocked(sendTelemetryEvent).mock.calls),
  ).not.toContain("unknown-private-step");
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
    run_steps: [{ step: "database_setup", duration_ms: 42 }],
  });
  const payload = JSON.stringify(vi.mocked(sendTelemetryEvent).mock.calls);
  expect(payload).not.toContain(error.message);
  expect(payload).not.toContain("private-password");
});

it("preserves retries, outcomes and missing phase timings per attempt", async () => {
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
  expect(events("e2e_test_run_completed")[0].testcases).toEqual([
    {
      case_id: "failed-first-attempt",
      case_index: 1,
      retry: 0,
      status: "failed",
      duration_ms: 30,
      timing_incomplete: true,
      steps: [
        { step: "setup", duration_ms: 10 },
        { step: "execution", duration_ms: 20 },
        { step: "cleanup", duration_ms: null },
      ],
    },
    {
      case_id: "successful-retry",
      case_index: 2,
      retry: 1,
      status: "completed",
      duration_ms: 60,
      timing_incomplete: false,
      steps: [
        { step: "setup", duration_ms: 20 },
        { step: "execution", duration_ms: 30 },
        { step: "cleanup", duration_ms: 10 },
      ],
    },
    {
      case_id: "skipped",
      case_index: 3,
      retry: 0,
      status: "skipped",
      duration_ms: 0,
      timing_incomplete: false,
      steps: [
        { step: "setup", duration_ms: 0 },
        { step: "execution", duration_ms: 0 },
        { step: "cleanup", duration_ms: 0 },
      ],
    },
    ...[
      {
        case_id: "interrupted-retry",
        case_index: 4,
        retry: 2,
        status: "cancelled",
      },
      {
        case_id: "cleanup-failure",
        case_index: 5,
        retry: null,
        status: "failed",
      },
    ].map((identity) => ({
      ...identity,
      duration_ms: null,
      timing_incomplete: true,
      steps: [
        { step: "setup", duration_ms: null },
        { step: "execution", duration_ms: null },
        { step: "cleanup", duration_ms: null },
      ],
    })),
  ]);
});

it("reports empty arrays for runs with no steps or cases", () => {
  timing().finish();
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    run_steps: [],
    testcases: [],
  });
});

it("keeps concurrent runs separate through explicit timer arguments", async () => {
  const first = timing(1);
  const second = timing(2);
  const callback = () =>
    measureTestRunStep(first, "queue_wait", async () => {
      await Promise.resolve();
    });
  await Promise.all([
    callback(),
    measureTestRunStep(second, "database_isolation", async () => {
      await Promise.resolve();
    }),
  ]);
  const completed = logEvents("e2e_test_step_completed");
  expect(completed.find(({ step }) => step === "queue_wait")).toMatchObject({
    run_id: 1,
  });
  expect(
    completed.find(({ step }) => step === "database_isolation"),
  ).toMatchObject({ run_id: 2 });
  expect(new Set(completed.map(({ timing_id }) => timing_id)).size).toBe(2);
  first.finish();
  second.finish();
  expect(
    events("e2e_test_run_completed").map(({ run_steps }) => run_steps),
  ).toEqual([
    [{ step: "waiting", duration_ms: 0 }],
    [{ step: "database_setup", duration_ms: 0 }],
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
    run_steps: [{ step: "cleanup", duration_ms: 100 }],
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
    run_steps: [{ step: "execution", duration_ms: 0 }],
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

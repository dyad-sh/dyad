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

it("logs start/end events for repeated steps and total time through cleanup", async () => {
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
  const completed = events("e2e_test_step_completed");
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
  expect(events("e2e_test_step_started").map(({ step_id }) => step_id)).toEqual(
    completed.map(({ step_id }) => step_id),
  );
  expect(events("e2e_test_run_completed")).toEqual([
    expect.objectContaining({
      duration_ms: 150,
      status: "completed",
      isolation_mode: "neon-branch",
    }),
  ]);
  expect(info.mock.calls).toEqual(vi.mocked(sendTelemetryEvent).mock.calls);
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
  expect(events("e2e_test_step_completed")[0]).toMatchObject({
    status: "failed",
    duration_ms: 42,
  });
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    status: "infra_error",
  });
  const payload = JSON.stringify(vi.mocked(sendTelemetryEvent).mock.calls);
  expect(payload).not.toContain(error.message);
  expect(payload).not.toContain("private-password");
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
  const completed = events("e2e_test_step_completed");
  expect(completed.find(({ step }) => step === "case_setup")).toMatchObject({
    run_id: 1,
  });
  expect(
    completed.find(({ step }) => step === "database_isolation"),
  ).toMatchObject({ run_id: 2 });
  expect(new Set(completed.map(({ timing_id }) => timing_id)).size).toBe(2);
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
  expect(events("e2e_test_step_completed")[0]).toMatchObject({
    status: "failed",
  });
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    status: "cancelled",
    duration_ms: 100,
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
  expect(events("e2e_test_step_completed").map(({ status }) => status)).toEqual(
    ["timed_out", "timed_out"],
  );
  expect(events("e2e_test_step_started")).toHaveLength(2);
  expect(events("e2e_test_run_completed")[0]).toMatchObject({
    status: "timed_out",
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
  expect(await measureTestRunStep(run, "case_setup", async () => 7)).toBe(7);
  await expect(
    measureTestRunStep(run, "case_cleanup", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(() => run.finish()).not.toThrow();
});

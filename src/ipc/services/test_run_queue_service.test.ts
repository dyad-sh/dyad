import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { performance } from "node:perf_hooks";
import { sendTelemetryEvent } from "../utils/telemetry";
import { measureTestRunStep } from "./test_run_timing";
import { loadTestRunContext } from "./test_run_context";
import { createTestRunQueueService } from "./test_run_queue_service";

const h = vi.hoisted(() => ({
  settings: {
    enableParallelTestRuns: false,
    maxConcurrentTestRuns: undefined as number | undefined,
  },
  databaseKey: undefined as string | undefined,
  branch: "main",
  fingerprint: "inputs",
  exclusive: false,
  remainingProcesses: [] as unknown[],
  info: vi.fn(),
}));
vi.mock("@/main/settings", () => ({ readSettings: () => h.settings }));
vi.mock("./test_run_context", () => ({
  loadTestRunContext: vi.fn(async () => ({
    inputFingerprint: h.fingerprint,
    exclusive: h.exclusive,
    databaseKey: h.databaseKey,
    branch: h.branch,
    revision: "abcdef",
  })),
}));
vi.mock("./e2e_test_process_registry", () => ({
  trackedE2eTestProcessesForOwner: () => h.remainingProcesses,
}));
vi.mock("../utils/window_broadcast", () => ({
  broadcastToRegisteredWindows: vi.fn(),
}));
vi.mock("../utils/telemetry", () => ({ sendTelemetryEvent: vi.fn() }));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: h.info,
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

let service: ReturnType<typeof createTestRunQueueService>;
const pending: { finish: () => void; result: Promise<string> }[] = [];
const admissions = () =>
  h.info.mock.calls
    .filter(([name]) => name === "e2e_test_admission_decision")
    .map(([, data]) => data);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.clearAllMocks();
  h.info.mockReset();
  h.settings.enableParallelTestRuns = false;
  h.settings.maxConcurrentTestRuns = undefined;
  h.databaseKey = undefined;
  h.branch = "main";
  h.fingerprint = "inputs";
  h.exclusive = false;
  h.remainingProcesses = [];
  service = createTestRunQueueService();
});
afterEach(async () => {
  service.stopAllAppTestRuns({ kind: "app-quit" });
  for (const run of pending) run.finish();
  await Promise.allSettled(pending.splice(0).map((run) => run.result));
  vi.useRealTimers();
});

function enqueue(appId = 1) {
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let signal: AbortSignal | undefined;
  const execute = vi.fn(async (run: { signal: AbortSignal }) => {
    signal = run.signal;
    await held;
    return "done";
  });
  const result = service.withAppTestRun(
    { appId, event: { sender: {} } as IpcMainInvokeEvent, source: "panel" },
    execute,
    () => "cancelled",
  );
  const run = {
    finish,
    result,
    execute,
    get signal() {
      return signal;
    },
  };
  pending.push(run);
  return run;
}
async function tick(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
}
it("times queued cancellation separately and retains the active run through cleanup", async () => {
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  let finish!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const options = {
    appId: 701,
    event: { sender: {} } as IpcMainInvokeEvent,
    source: "agent" as const,
  };
  const active = service.withAppTestRun(
    options,
    async (_run, timing) => {
      await measureTestRunStep(timing, "database_teardown", () => cleanup);
      return "done";
    },
    () => "cancelled",
  );
  await vi.waitFor(() =>
    expect(service.isTestRunActive(options.appId)).toBe(true),
  );
  now = 10;
  const cancelledSignal = new AbortController();
  const executeQueued = vi.fn(async () => "unexpected");
  const queued = service.withAppTestRun(
    { ...options, externalSignal: cancelledSignal.signal },
    executeQueued,
    () => "cancelled",
  );
  try {
    now = 60;
    cancelledSignal.abort();
    expect(await queued).toBe("cancelled");
    expect(executeQueued).not.toHaveBeenCalled();
    const summaries = () =>
      vi
        .mocked(sendTelemetryEvent)
        .mock.calls.filter(([event]) => event === "e2e_test_run_completed")
        .map(([, properties]) => properties!);
    expect(summaries()).toEqual([
      expect.objectContaining({
        status: "cancelled",
        duration_ms: 50,
      }),
    ]);
    now = 100;
    finish();
    expect(await active).toBe("done");
    expect(summaries()).toHaveLength(2);
    expect(summaries()[1]).toMatchObject({
      duration_ms: 100,
    });
    expect(summaries()[0].timing_id).not.toBe(summaries()[1].timing_id);
    expect(summaries()[1].run_steps).toContainEqual({
      step: "cleanup",
      duration_ms: 100,
    });
    expect(sendTelemetryEvent).toHaveBeenCalledTimes(2);
  } finally {
    finish();
    await Promise.allSettled([active, queued]);
    clock.mockRestore();
  }
});

it("fences new requests and settles queued requests before app deletion drains cleanup", async () => {
  let finish!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const options = {
    appId: 501,
    event: { sender: {} } as IpcMainInvokeEvent,
    source: "agent" as const,
  };
  const first = service.withAppTestRun(
    options,
    async () => {
      await cleanup;
      return "done";
    },
    () => "cancelled",
  );
  const execute = vi.fn(async () => "unexpected");
  const second = service.withAppTestRun(
    options,
    execute,
    (reason) => reason.kind,
  );
  await vi.waitFor(() =>
    expect(service.isTestRunActive(options.appId)).toBe(true),
  );
  const deletion = service.beginAppTestDeletion(options.appId);
  try {
    expect(await second).toBe("app-deleted");
    expect(execute).not.toHaveBeenCalled();
    await expect(
      service.withAppTestRun(options, execute, () => "cancelled"),
    ).rejects.toThrow("being deleted");
    expect(service.isTestRunActive(options.appId)).toBe(true);
    const drained = vi.fn();
    const drain = deletion.drain().then(drained);
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();
    finish();
    await Promise.all([first, drain]);
    expect(service.isTestRunActive(options.appId)).toBe(false);
  } finally {
    finish();
    await Promise.allSettled([first, second, deletion.drain()]);
    deletion.release();
  }
});

it("stops active and queued runs across apps while retaining their cleanup", async () => {
  let finish!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const signals: AbortSignal[] = [];
  const pending = [601, 602].map((appId) => {
    const options = {
      appId,
      event: { sender: {} } as IpcMainInvokeEvent,
      source: "panel" as const,
    };
    const active = service.withAppTestRun(
      options,
      async ({ signal }) => {
        signals.push(signal);
        await cleanup;
        return "done";
      },
      () => "cancelled",
    );
    const executeQueued = vi.fn(async () => "unexpected");
    const queued = service.withAppTestRun(
      options,
      executeQueued,
      (reason) => reason.kind,
    );
    return { appId, active, queued, executeQueued };
  });
  await vi.waitFor(() => expect(signals).toHaveLength(1));
  service.stopAllAppTestRuns({ kind: "app-quit" });
  expect(signals).toHaveLength(1);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(signals.map((signal) => signal.reason.kind)).toEqual(["app-quit"]);
  for (const run of pending) {
    expect(await run.queued).toBe("app-quit");
    expect(run.executeQueued).not.toHaveBeenCalled();
    expect(service.isTestRunActive(run.appId)).toBe(run.appId === 601);
  }
  const drained = vi.fn();
  const drain = Promise.all(
    pending.map(({ appId }) => service.drainAppTestRuns(appId)),
  ).then(drained);
  await Promise.resolve();
  expect(drained).not.toHaveBeenCalled();
  finish();
  await Promise.all([...pending.map(({ active }) => active), drain]);
  expect(pending.every(({ appId }) => !service.isTestRunActive(appId))).toBe(
    true,
  );
});

it.each([undefined, "neon:project:1", "supabase:project"])(
  "overlaps compatible runs with database %s and cancels them independently",
  async (databaseKey) => {
    h.settings.enableParallelTestRuns = true;
    h.databaseKey = databaseKey;
    const first = enqueue();
    const second = enqueue();
    await tick();
    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).toHaveBeenCalledOnce();
    service.cancelAppTestRun(
      1,
      service.getAppTestRunQueue(1).activeRuns[0].runId,
      { kind: "tests-panel-stop" },
    );
    expect(first.signal?.aborted).toBe(true);
    expect(second.signal?.aborted).toBe(false);
  },
);

it.each(["database", "exclusive"])(
  "preserves %s compatibility checks",
  async (kind) => {
    h.settings.enableParallelTestRuns = true;
    h.databaseKey = "neon:project:1";
    const first = enqueue();
    await tick();
    if (kind === "database") h.branch = "other";
    else h.exclusive = true;
    const second = enqueue();
    await tick();
    expect(second.execute).not.toHaveBeenCalled();
    expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toContain(
      "compatible database and workspace",
    );
    first.finish();
    await first.result;
    await tick();
    expect(second.execute).toHaveBeenCalledOnce();
  },
);

it("validates workspace inputs again before setup", async () => {
  h.settings.enableParallelTestRuns = true;
  enqueue();
  await tick();
  const runId = service.getAppTestRunQueue(1).activeRuns[0].runId;
  await expect(service.validateTestRunInputs(runId)).resolves.toBeUndefined();
  h.fingerprint = "changed";
  await expect(service.validateTestRunInputs(runId)).rejects.toThrow(
    "test inputs changed",
  );
});

it("rechecks cancellation after loading admission metadata", async () => {
  h.settings.enableParallelTestRuns = true;
  let loaded!: (value: Awaited<ReturnType<typeof loadTestRunContext>>) => void;
  vi.mocked(loadTestRunContext).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
  );
  const first = enqueue();
  await tick();
  service.stopAllAppTestRuns({ kind: "app-quit" });
  loaded({ inputFingerprint: "inputs", exclusive: false });
  await tick();
  expect(await first.result).toBe("cancelled");
  expect(first.execute).not.toHaveBeenCalled();
});

it("fences admission when a run fails to stop its processes", async () => {
  h.settings.enableParallelTestRuns = true;
  h.settings.maxConcurrentTestRuns = 1;
  const first = enqueue();
  const second = enqueue();
  await tick();
  h.remainingProcesses = [{}];
  first.finish();
  await first.result;
  await tick();
  expect(second.execute).not.toHaveBeenCalled();
  expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toContain(
    "could not be stopped",
  );
});

it("returns to serial admission when parallel runs are disabled", async () => {
  h.settings.enableParallelTestRuns = true;
  const first = enqueue();
  const second = enqueue();
  const third = enqueue();
  await tick();
  h.settings.enableParallelTestRuns = false;
  first.finish();
  await first.result;
  await tick();
  expect(second.signal?.aborted).toBe(false);
  expect(third.execute).not.toHaveBeenCalled();
  second.finish();
  await second.result;
  expect(third.execute).toHaveBeenCalledOnce();
});

it("diagnostic failures cannot prevent completion or the next admission", async () => {
  h.settings.enableParallelTestRuns = true;
  h.info.mockImplementation(() => {
    throw new Error("logging unavailable");
  });
  const first = enqueue();
  const second = enqueue();
  await tick();
  first.finish();
  expect(await first.result).toBe("done");
  await tick();
  expect(second.execute).toHaveBeenCalledOnce();
});

it("starts two compatible runs immediately and keeps that limit after completions", async () => {
  h.settings.enableParallelTestRuns = true;
  const runs = [enqueue(1), enqueue(2), enqueue(3), enqueue(4)];
  await tick();
  expect(runs[0].execute).toHaveBeenCalledOnce();
  expect(runs[1].execute).toHaveBeenCalledOnce();
  expect(runs[2].execute).not.toHaveBeenCalled();
  expect(runs[3].execute).not.toHaveBeenCalled();
  runs[0].finish();
  await runs[0].result;
  await tick();
  expect(runs[2].execute).toHaveBeenCalledOnce();
  expect(runs[3].execute).not.toHaveBeenCalled();
  expect(runs[1].signal?.aborted).toBe(false);
  expect(admissions().every((entry) => entry.admission.limit === 2)).toBe(true);
});

it.each([1, 3, 5])("honors a saved concurrency limit of %i", async (limit) => {
  h.settings.enableParallelTestRuns = true;
  h.settings.maxConcurrentTestRuns = limit;
  const runs = Array.from({ length: limit + 1 }, () => enqueue());
  await tick();
  expect(service.getAppTestRunQueue(1).activeRuns).toHaveLength(limit);
  expect(runs[limit].execute).not.toHaveBeenCalled();
  runs[0].finish();
  await runs[0].result;
  await tick();
  expect(runs[limit].execute).toHaveBeenCalledOnce();
  expect(service.getAppTestRunQueue(1).activeRuns).toHaveLength(limit);
});

it("fills newly available slots when the user raises the limit", async () => {
  h.settings.enableParallelTestRuns = true;
  const runs = [enqueue(), enqueue(), enqueue(), enqueue(), enqueue()];
  await tick();
  h.settings.maxConcurrentTestRuns = 4;
  await tick(2000);
  expect(service.getAppTestRunQueue(1).activeRuns).toHaveLength(4);
  for (const run of runs.slice(0, 4))
    expect(run.execute).toHaveBeenCalledOnce();
  expect(runs[4].execute).not.toHaveBeenCalled();
});

it("lets active runs finish when the limit is lowered and waits for a free slot", async () => {
  h.settings.enableParallelTestRuns = true;
  h.settings.maxConcurrentTestRuns = 3;
  const runs = [enqueue(), enqueue(), enqueue(), enqueue()];
  await tick();
  h.settings.maxConcurrentTestRuns = 1;
  await tick(2000);
  for (const run of runs.slice(0, 3)) expect(run.signal?.aborted).toBe(false);
  for (const run of runs.slice(0, 2)) {
    run.finish();
    await run.result;
    await tick();
    expect(runs[3].execute).not.toHaveBeenCalled();
  }
  runs[2].finish();
  await runs[2].result;
  await tick();
  expect(runs[3].execute).toHaveBeenCalledOnce();
});

it("rechecks the configured limit after loading admission metadata", async () => {
  h.settings.enableParallelTestRuns = true;
  const first = enqueue();
  await tick();
  let loaded!: (value: Awaited<ReturnType<typeof loadTestRunContext>>) => void;
  vi.mocked(loadTestRunContext).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
  );
  const second = enqueue();
  await tick();
  h.settings.maxConcurrentTestRuns = 1;
  loaded({ inputFingerprint: "inputs", exclusive: false });
  await tick();
  expect(second.execute).not.toHaveBeenCalled();
  first.finish();
  await first.result;
  await tick();
  expect(second.execute).toHaveBeenCalledOnce();
});

it("retains a cancelled run's slot until cleanup settles", async () => {
  h.settings.enableParallelTestRuns = true;
  const first = enqueue();
  const second = enqueue();
  const third = enqueue();
  await tick();
  service.cancelAppTestRun(
    1,
    service.getAppTestRunQueue(1).activeRuns[0].runId,
    { kind: "tests-panel-stop" },
  );
  await tick();
  expect(first.signal?.aborted).toBe(true);
  expect(second.signal?.aborted).toBe(false);
  expect(third.execute).not.toHaveBeenCalled();
  first.finish();
  await first.result;
  await tick();
  expect(third.execute).toHaveBeenCalledOnce();
});

it("does not consume capacity for a queued cancellation", async () => {
  h.settings.enableParallelTestRuns = true;
  const first = enqueue();
  enqueue();
  const third = enqueue();
  const fourth = enqueue();
  await tick();
  service.cancelAppTestRun(
    1,
    service.getAppTestRunQueue(1).queuedRuns[0].runId,
    { kind: "tests-panel-stop" },
  );
  expect(await third.result).toBe("cancelled");
  expect(third.execute).not.toHaveBeenCalled();
  first.finish();
  await first.result;
  await tick();
  expect(fourth.execute).toHaveBeenCalledOnce();
});

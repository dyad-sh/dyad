import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { performance } from "node:perf_hooks";
import type { SystemResourceUsage } from "../types/system";
import { sendTelemetryEvent } from "../utils/telemetry";
import { measureTestRunStep } from "./test_run_timing";
import { loadTestRunContext } from "./test_run_context";
import { createTestRunQueueService } from "./test_run_queue_service";

const h = vi.hoisted(() => ({
  settings: { enableParallelTestRuns: false },
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
vi.mock("@/utils/system_resource_usage", () => ({
  getSystemResourceUsage: vi.fn(),
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
let usage: SystemResourceUsage;
const sampleResources = vi.fn<() => Promise<SystemResourceUsage>>();
const pending: { finish: () => void; result: Promise<string> }[] = [];
const feedback = () =>
  h.info.mock.calls
    .filter(([name]) => name === "e2e_test_concurrency_updated")
    .map(([, data]) => data);
const admissions = () =>
  h.info.mock.calls
    .filter(([name]) => name === "e2e_test_admission_decision")
    .map(([, data]) => data);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.clearAllMocks();
  h.info.mockReset();
  h.settings.enableParallelTestRuns = false;
  h.databaseKey = undefined;
  h.branch = "main";
  h.fingerprint = "inputs";
  h.exclusive = false;
  h.remainingProcesses = [];
  usage = {
    sampledAt: Date.now(),
    platform: "linux",
    cpu: { logicalCores: 8, usedPercent: 10 },
    memory: {
      totalBytes: 1000,
      usedBytes: 400,
      source: "linux",
      committedBytes: null,
      commitLimitBytes: null,
      compressedBytes: null,
      swapUsedBytes: null,
    },
  };
  sampleResources.mockReset().mockImplementation(async () => ({
    ...usage,
    sampledAt: Date.now(),
    cpu: { ...usage.cpu },
    memory: { ...usage.memory },
  }));
  service = createTestRunQueueService({ sampleResources });
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
async function learnTwo() {
  h.settings.enableParallelTestRuns = true;
  const first = enqueue();
  await tick();
  first.finish();
  await first.result;
  expect(feedback().at(-1)).toMatchObject({ previous_limit: 1, next_limit: 2 });
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

it("starts at one without history, grows only at completion, and fills slots during startup", async () => {
  h.settings.enableParallelTestRuns = true;
  const first = enqueue(1);
  const second = enqueue(2);
  const third = enqueue(3);
  await tick(6000);
  expect(first.execute).toHaveBeenCalledOnce();
  expect(second.execute).not.toHaveBeenCalled();
  expect(third.execute).not.toHaveBeenCalled();
  expect(feedback()).toEqual([]);
  expect(
    admissions().filter((entry) => entry.decision === "queued"),
  ).toHaveLength(1);
  first.finish();
  await first.result;
  await tick();
  expect(second.execute).toHaveBeenCalledOnce();
  expect(third.execute).toHaveBeenCalledOnce();
  expect(feedback()).toEqual([
    expect.objectContaining({
      active_run_count: 1,
      previous_limit: 1,
      next_limit: 2,
    }),
  ]);
  // These promises still represent startup: neither needs to finish setup to overlap.
  expect(second.signal?.aborted).toBe(false);
  expect(third.signal?.aborted).toBe(false);
});

it.each(["CPU", "memory"])(
  "uses peak %s to drain the active batch and decrease only at its end",
  async (resource) => {
    await learnTwo();
    const first = enqueue();
    const second = enqueue();
    const third = enqueue();
    await tick();
    if (resource === "CPU") usage.cpu.usedPercent = 95;
    else usage.memory.usedBytes = 950;
    await tick(2000);
    usage.cpu.usedPercent = 10;
    usage.memory.usedBytes = 400;
    await tick(2000);
    expect(feedback()).toHaveLength(1);
    first.finish();
    await first.result;
    await tick();
    expect(feedback().at(-1)).toMatchObject({
      previous_limit: 2,
      next_limit: 2,
      batch_decrease_pending: true,
    });
    expect(
      feedback().at(-1)[
        resource === "CPU"
          ? "peak_system_cpu_percent"
          : "peak_system_memory_percent"
      ],
    ).toBe(95);
    expect(second.signal?.aborted).toBe(false);
    expect(third.execute).not.toHaveBeenCalled();
    expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toContain(
      "active test batch",
    );
    second.finish();
    await second.result;
    await tick();
    expect(third.execute).toHaveBeenCalledOnce();
    expect(feedback().at(-1)).toMatchObject({
      previous_limit: 2,
      next_limit: 1,
      batch_decrease_pending: false,
    });
  },
);

it("holds the limit for underutilized runs and has no ceiling at two", async () => {
  await learnTwo();
  const solo = enqueue();
  await tick();
  solo.finish();
  await solo.result;
  expect(feedback().at(-1)).toMatchObject({
    active_run_count: 1,
    previous_limit: 2,
    next_limit: 2,
  });
  const first = enqueue();
  const second = enqueue();
  const third = enqueue();
  const fourth = enqueue();
  await tick();
  first.finish();
  await first.result;
  await tick();
  expect(feedback().at(-1)).toMatchObject({
    active_run_count: 2,
    previous_limit: 2,
    next_limit: 3,
  });
  expect(service.getAppTestRunQueue(1).activeRuns).toHaveLength(3);
  for (const run of [second, third, fourth])
    expect(run.execute).toHaveBeenCalledOnce();
});

it("applies simultaneous completions once each using the active count before each release", async () => {
  await learnTwo();
  const first = enqueue();
  const second = enqueue();
  await tick();
  first.finish();
  second.finish();
  await Promise.all([first.result, second.result]);
  expect(feedback().slice(1)).toEqual([
    expect.objectContaining({
      active_run_count: 2,
      previous_limit: 2,
      next_limit: 3,
    }),
    expect.objectContaining({
      active_run_count: 1,
      previous_limit: 3,
      next_limit: 3,
    }),
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it("admits a solo run even during overload and never drops the limit below one", async () => {
  h.settings.enableParallelTestRuns = true;
  usage.cpu.usedPercent = 100;
  usage.memory.usedBytes = 1000;
  const first = enqueue();
  const second = enqueue();
  await tick();
  expect(first.execute).toHaveBeenCalledOnce();
  first.finish();
  await first.result;
  await tick();
  expect(second.execute).toHaveBeenCalledOnce();
  expect(feedback().at(-1)).toMatchObject({ previous_limit: 1, next_limit: 1 });
});

it.each(["CPU", "memory"])("holds at exactly 90%% %s", async (resource) => {
  h.settings.enableParallelTestRuns = true;
  if (resource === "CPU") usage.cpu.usedPercent = 90;
  else usage.memory.usedBytes = 900;
  const first = enqueue();
  await tick();
  first.finish();
  await first.result;
  expect(feedback().at(-1)).toMatchObject({ previous_limit: 1, next_limit: 1 });
});

it.each(["missing CPU", "fallback memory", "stale", "future", "failure"])(
  "does not grow on %s measurements",
  async (kind) => {
    h.settings.enableParallelTestRuns = true;
    if (kind === "missing CPU") usage.cpu.usedPercent = null;
    if (kind === "fallback memory") usage.memory.source = "fallback";
    if (kind === "stale")
      sampleResources.mockImplementation(async () => ({
        ...usage,
        sampledAt: Date.now() - 20000,
      }));
    if (kind === "future")
      sampleResources.mockImplementation(async () => ({
        ...usage,
        sampledAt: Date.now() + 20000,
      }));
    if (kind === "failure")
      sampleResources.mockRejectedValue(new Error("unavailable"));
    const first = enqueue();
    const second = enqueue();
    await tick();
    first.finish();
    await first.result;
    await tick();
    expect(feedback().at(-1)).toMatchObject({
      previous_limit: 1,
      next_limit: 1,
    });
    expect(second.execute).toHaveBeenCalledOnce();
  },
);

it("waits for an in-flight sample from the run without inheriting it into the next run", async () => {
  await learnTwo();
  let sampled!: (sample: SystemResourceUsage) => void;
  sampleResources.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        sampled = resolve;
      }),
  );
  const first = enqueue();
  await tick();
  const duringRun = Date.now();
  const second = enqueue();
  await tick();
  first.finish();
  await tick();
  expect(service.getAppTestRunQueue(1).activeRuns).toHaveLength(2);
  sampled({
    ...usage,
    sampledAt: duringRun,
    cpu: { ...usage.cpu, usedPercent: 95 },
  });
  await first.result;
  expect(feedback().at(-1)).toMatchObject({
    previous_limit: 2,
    next_limit: 2,
    batch_decrease_pending: true,
    peak_system_cpu_percent: 95,
  });
  second.finish();
  await second.result;
  expect(feedback().at(-1)).toMatchObject({
    previous_limit: 2,
    next_limit: 1,
    batch_decrease_pending: false,
    batch_peak_system_cpu_percent: 95,
    peak_system_cpu_percent: null,
    peak_system_memory_percent: null,
  });
});

it("reduces a six-run batch to five once, then starts queued runs together across apps", async () => {
  await learnTwo();
  for (const limit of [2, 3, 4, 5]) {
    const training = Array.from({ length: limit }, () => enqueue());
    await tick();
    training[0].finish();
    await training[0].result;
    for (const run of training.slice(1)) run.finish();
    await Promise.all(training.map((run) => run.result));
    expect(feedback().at(-1).next_limit).toBe(limit + 1);
  }
  h.info.mockClear();
  usage.cpu.usedPercent = 100;
  const runs = Array.from({ length: 8 }, (_, index) => enqueue(index + 10));
  await tick(2010);
  for (const run of runs.slice(0, 6))
    expect(run.execute).toHaveBeenCalledOnce();
  for (const run of runs.slice(6)) expect(run.execute).not.toHaveBeenCalled();
  usage.cpu.usedPercent = 10;
  for (const run of runs.slice(0, 5)) {
    run.finish();
    await run.result;
    await tick();
    expect(feedback().at(-1)).toMatchObject({
      previous_limit: 6,
      next_limit: 6,
      batch_decrease_pending: true,
    });
    for (const queued of runs.slice(6))
      expect(queued.execute).not.toHaveBeenCalled();
  }
  runs[5].finish();
  await runs[5].result;
  await tick();
  expect(feedback().at(-1)).toMatchObject({
    previous_limit: 6,
    next_limit: 5,
    batch_decrease_pending: false,
  });
  expect(
    feedback().filter((event) => event.next_limit < event.previous_limit),
  ).toHaveLength(1);
  for (const queued of runs.slice(6)) {
    expect(queued.execute).toHaveBeenCalledOnce();
    expect(queued.signal?.aborted).toBe(false);
  }
  expect(
    admissions()
      .filter((event) => event.decision === "admitted")
      .slice(-2),
  ).toEqual([
    expect.objectContaining({
      admission: expect.objectContaining({
        limit: 5,
        batch_decrease_pending: false,
      }),
    }),
    expect.objectContaining({
      admission: expect.objectContaining({
        limit: 5,
        batch_decrease_pending: false,
      }),
    }),
  ]);
  // A later overloaded group gets its own single decrease.
  usage.cpu.usedPercent = 95;
  await tick(2000);
  runs[6].finish();
  await runs[6].result;
  expect(feedback().at(-1)).toMatchObject({ previous_limit: 5, next_limit: 5 });
  runs[7].finish();
  await runs[7].result;
  expect(feedback().at(-1)).toMatchObject({
    previous_limit: 5,
    next_limit: 4,
    batch_decrease_pending: false,
  });
});

it("cancellation retains the draining batch through cleanup and then releases admission", async () => {
  await learnTwo();
  usage.cpu.usedPercent = 95;
  const first = enqueue();
  const second = enqueue();
  const third = enqueue();
  await tick(2010);
  first.finish();
  await first.result;
  await tick();
  service.cancelAppTestRun(
    1,
    service.getAppTestRunQueue(1).activeRuns[0].runId,
    { kind: "tests-panel-stop" },
  );
  await tick();
  expect(second.signal?.aborted).toBe(true);
  expect(third.execute).not.toHaveBeenCalled();
  expect(feedback().at(-1)).toMatchObject({
    next_limit: 2,
    batch_decrease_pending: true,
  });
  second.finish();
  await second.result;
  await tick();
  expect(third.execute).toHaveBeenCalledOnce();
  expect(feedback().at(-1)).toMatchObject({
    previous_limit: 2,
    next_limit: 1,
    batch_decrease_pending: false,
  });
});

it("applies one decrease when overloaded batch members finish simultaneously", async () => {
  await learnTwo();
  usage.cpu.usedPercent = 95;
  const first = enqueue();
  const second = enqueue();
  await tick(2010);
  first.finish();
  second.finish();
  await Promise.all([first.result, second.result]);
  expect(feedback().slice(1)).toEqual([
    expect.objectContaining({
      previous_limit: 2,
      next_limit: 2,
      batch_decrease_pending: true,
    }),
    expect.objectContaining({
      previous_limit: 2,
      next_limit: 1,
      batch_decrease_pending: false,
    }),
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it("rechecks the batch drain after awaiting admission metadata", async () => {
  await learnTwo();
  usage.cpu.usedPercent = 95;
  const first = enqueue();
  const second = enqueue();
  await tick(2010);
  let loaded!: (value: Awaited<ReturnType<typeof loadTestRunContext>>) => void;
  vi.mocked(loadTestRunContext).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
  );
  const third = enqueue();
  await tick();
  first.finish();
  await first.result;
  loaded({ inputFingerprint: "inputs", exclusive: false });
  await tick();
  expect(third.execute).not.toHaveBeenCalled();
  expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toContain(
    "active test batch",
  );
  second.finish();
  await second.result;
  await tick();
  expect(third.execute).toHaveBeenCalledOnce();
});

it("clears a pending batch decrease when parallel runs are disabled", async () => {
  await learnTwo();
  usage.cpu.usedPercent = 95;
  const first = enqueue();
  const second = enqueue();
  const third = enqueue();
  await tick(2010);
  first.finish();
  await first.result;
  expect(feedback().at(-1).batch_decrease_pending).toBe(true);
  h.settings.enableParallelTestRuns = false;
  await tick();
  expect(third.execute).not.toHaveBeenCalled();
  second.finish();
  await second.result;
  third.finish();
  await third.result;
  usage.cpu.usedPercent = 10;
  h.settings.enableParallelTestRuns = true;
  const fresh = enqueue();
  await tick();
  fresh.finish();
  await fresh.result;
  expect(feedback().at(-1)).toMatchObject({
    previous_limit: 1,
    next_limit: 2,
    batch_decrease_pending: false,
  });
});

it("does not include a sample timestamped after a run ended", async () => {
  h.settings.enableParallelTestRuns = true;
  let sampled!: (sample: SystemResourceUsage) => void;
  sampleResources.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        sampled = resolve;
      }),
  );
  const first = enqueue();
  await tick();
  first.finish();
  await tick();
  sampled({ ...usage, sampledAt: Date.now() });
  await first.result;
  expect(feedback().at(-1)).toMatchObject({
    previous_limit: 1,
    next_limit: 1,
    peak_system_cpu_percent: null,
  });
});

it("does not adjust concurrency for queued cancellations", async () => {
  h.settings.enableParallelTestRuns = true;
  const first = enqueue();
  const second = enqueue();
  await tick();
  service.cancelAppTestRun(
    1,
    service.getAppTestRunQueue(1).queuedRuns[0].runId,
    { kind: "tests-panel-stop" },
  );
  expect(await second.result).toBe("cancelled");
  expect(feedback()).toHaveLength(0);
  expect(first.signal?.aborted).toBe(false);
});

it.each([undefined, "neon:project:1", "supabase:project"])(
  "overlaps compatible runs with database %s and cancels them independently",
  async (databaseKey) => {
    await learnTwo();
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
    await learnTwo();
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
  expect(feedback()).toHaveLength(0);
});

it("fences admission when a run fails to stop its processes", async () => {
  h.settings.enableParallelTestRuns = true;
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
  await learnTwo();
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
  expect(feedback().at(-1)).toMatchObject({
    next_limit: 1,
    parallel_enabled: false,
  });
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

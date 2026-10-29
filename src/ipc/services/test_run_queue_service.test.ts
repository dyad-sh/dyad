import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { performance } from "node:perf_hooks";
import { readSettings } from "@/main/settings";
import { sendTelemetryEvent } from "../utils/telemetry";
import { measureTestRunStep } from "./test_run_timing";
import { loadTestRunContext } from "./test_run_context";
import { createTestRunQueueService } from "./test_run_queue_service";
import { TestRunQueueSchema } from "../types/tests";

const h = vi.hoisted(() => ({
  settings: {
    enableParallelTestRuns: false,
    maxConcurrentTestRuns: undefined as number | undefined,
  },
  databaseKey: undefined as string | undefined,
  branch: "main",
  exclusive: false,
  remainingProcesses: [] as unknown[],
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ ...h.settings })),
}));
vi.mock("./test_run_context", () => ({
  loadTestRunContext: vi.fn(),
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
      warn: h.warn,
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
  h.exclusive = false;
  h.remainingProcesses = [];
  vi.mocked(loadTestRunContext)
    .mockReset()
    .mockImplementation(async (request) => ({
      workspaceKey: `/app-${request.appId}`,
      exclusive: h.exclusive,
      databaseKey: h.databaseKey,
      branch: h.branch,
      revision: "abcdef",
    }));
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

it("publishes app-scoped Neon capacity waits and clears them on cancellation", async () => {
  const run = enqueue(1);
  await tick();
  const runId = service.getAppTestRunQueue(1).activeRun!.runId;
  service.setNeonBranchLimit(runId, "project", "waiting");
  expect(service.getAppTestRunQueue(1).neonBranchLimit).toEqual({
    runId,
    projectId: "project",
    status: "waiting",
  });
  expect(service.getAppTestRunQueue(2).neonBranchLimit).toBeUndefined();
  service.cancelAppTestRun(1, runId, { kind: "tests-panel-stop" });
  expect(service.getAppTestRunQueue(1).neonBranchLimit).toBeUndefined();
  service.setNeonBranchLimit(runId, "project", "blocked");
  expect(service.getAppTestRunQueue(1).neonBranchLimit).toBeUndefined();
  run.finish();
  await run.result;
});

it("retains blocked plan notices after setup fails, until a new run obtains capacity", async () => {
  const failed = enqueue(1);
  await tick();
  const firstId = service.getAppTestRunQueue(1).activeRun!.runId;
  service.setNeonBranchLimit(firstId, "project", "blocked");
  failed.finish();
  await failed.result;
  expect(service.getAppTestRunQueue(1).neonBranchLimit?.status).toBe("blocked");
  const succeeding = enqueue(1);
  await tick();
  const nextId = service.getAppTestRunQueue(1).activeRun!.runId;
  service.setNeonBranchLimit(nextId, "project", undefined);
  expect(service.getAppTestRunQueue(1).neonBranchLimit).toBeUndefined();
  service.setNeonBranchLimit(firstId, "project", "blocked");
  expect(service.getAppTestRunQueue(1).neonBranchLimit).toBeUndefined();
  succeeding.finish();
  await succeeding.result;
});

it("projects every waiting run and clears each wait independently", async () => {
  h.settings.enableParallelTestRuns = true;
  h.settings.maxConcurrentTestRuns = 4;
  enqueue(1);
  enqueue(1);
  enqueue(1);
  enqueue(2);
  await tick();
  const [running, firstWaiting, secondWaiting] =
    service.getAppTestRunQueue(1).activeRuns;
  service.setNeonBranchLimit(firstWaiting.runId, "project", "waiting");
  service.setNeonBranchLimit(secondWaiting.runId, "project", "waiting");
  const snapshot = TestRunQueueSchema.parse(service.getAppTestRunQueue(1));
  expect(
    snapshot.activeRuns?.map((run) => [run.runId, run.waitingForNeonBranch]),
  ).toEqual([
    [running.runId, false],
    [firstWaiting.runId, true],
    [secondWaiting.runId, true],
  ]);
  expect(service.getAppTestRunQueue(2).activeRun?.waitingForNeonBranch).toBe(
    false,
  );

  service.setNeonBranchLimit(firstWaiting.runId, "project", undefined);
  expect(
    service
      .getAppTestRunQueue(1)
      .activeRuns.map((run) => run.waitingForNeonBranch),
  ).toEqual([false, false, true]);
  service.cancelAppTestRun(1, secondWaiting.runId, {
    kind: "tests-panel-stop",
  });
  expect(
    service
      .getAppTestRunQueue(1)
      .activeRuns.every((run) => !run.waitingForNeonBranch),
  ).toBe(true);
  expect(service.getAppTestRunQueue(1).neonBranchLimit).toBeUndefined();
});
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
  await vi.waitFor(() => expect(signals).toHaveLength(2));
  service.stopAllAppTestRuns({ kind: "app-quit" });
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(signals.map((signal) => signal.reason.kind)).toEqual([
    "app-quit",
    "app-quit",
  ]);
  for (const run of pending) {
    expect(await run.queued).toBe("app-quit");
    expect(run.executeQueued).not.toHaveBeenCalled();
    expect(service.isTestRunActive(run.appId)).toBe(true);
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

it.each([undefined, "supabase:project"])(
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
    h.databaseKey = "supabase:project";
    const first = enqueue();
    await tick();
    if (kind === "database") h.branch = "other";
    else h.exclusive = true;
    const second = enqueue();
    await tick();
    expect(second.execute).not.toHaveBeenCalled();
    expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toBe(
      "compatibility",
    );
    first.finish();
    await first.result;
    await tick();
    expect(second.execute).toHaveBeenCalledOnce();
  },
);

it("refreshes changed inputs when no conflicting run is active", async () => {
  h.settings.enableParallelTestRuns = true;
  enqueue();
  await tick();
  const runId = service.getAppTestRunQueue(1).activeRuns[0].runId;
  await expect(service.validateTestRunInputs(runId)).resolves.toBeUndefined();
  h.branch = "changed";
  await expect(service.validateTestRunInputs(runId)).resolves.toBeUndefined();
  expect(service.getAppTestRunQueue(1).activeRun?.branch).toBe("changed");
});

it("reserves conflicting resources for an earlier waiter while independent apps proceed", async () => {
  h.settings.enableParallelTestRuns = true;
  h.settings.maxConcurrentTestRuns = 3;
  vi.mocked(loadTestRunContext).mockImplementation(async ({ appId }) => ({
    workspaceKey: `/app-${appId}`,
    databaseKey: appId === 3 ? undefined : "supabase:shared",
    branch: appId === 2 ? "other" : "main",
    revision: "abcdef",
    exclusive: false,
  }));
  const active = enqueue(1);
  await tick();
  const older = enqueue(2);
  const later = enqueue(1);
  const independent = enqueue(3);
  await tick();
  expect(independent.execute).toHaveBeenCalledOnce();
  expect(older.execute).not.toHaveBeenCalled();
  expect(later.execute).not.toHaveBeenCalled();
  expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toBe(
    "earlier-run",
  );
  active.finish();
  await active.result;
  await tick();
  expect(older.execute).toHaveBeenCalledOnce();
  expect(later.execute).not.toHaveBeenCalled();
  older.finish();
  await older.result;
  await tick();
  expect(later.execute).toHaveBeenCalledOnce();
});

it("caches blocked admission metadata and refreshes after ownership changes", async () => {
  h.settings.enableParallelTestRuns = true;
  h.databaseKey = "supabase:shared";
  const active = enqueue(1);
  await tick();
  h.branch = "other";
  const blocked = enqueue(2);
  await tick();
  const reads = vi.mocked(loadTestRunContext).mock.calls.length;
  await tick(6000);
  expect(loadTestRunContext).toHaveBeenCalledTimes(reads);
  expect(blocked.execute).not.toHaveBeenCalled();
  active.finish();
  await active.result;
  await tick();
  expect(loadTestRunContext).toHaveBeenCalledTimes(reads + 1);
  expect(blocked.execute).toHaveBeenCalledOnce();
});

it("reads settings once per blocked admission pass even with a large backlog", async () => {
  h.settings.enableParallelTestRuns = true;
  h.databaseKey = "supabase:shared";
  enqueue(1);
  await tick();
  h.branch = "other";
  for (let appId = 2; appId <= 41; appId++) enqueue(appId);
  vi.mocked(readSettings).mockClear();
  await tick();
  expect(readSettings).toHaveBeenCalledOnce();
  expect(service.getAppTestRunQueue(41).queuedRuns[0].queuedReason).toBe(
    "compatibility",
  );
  await tick(6000);
  expect(readSettings).toHaveBeenCalledTimes(4);
});

it("reports metadata failures and retries them on the slow refresh interval", async () => {
  h.settings.enableParallelTestRuns = true;
  const error = new Error("Cannot read Git repository");
  vi.mocked(loadTestRunContext).mockRejectedValueOnce(error);
  const run = enqueue(1);
  await tick();
  expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toBe(
    "context-unavailable",
  );
  expect(h.warn).toHaveBeenCalledWith(
    "Failed to load test admission context",
    expect.objectContaining({ appId: 1, error }),
  );
  await tick(6000);
  expect(loadTestRunContext).toHaveBeenCalledOnce();
  expect(run.execute).not.toHaveBeenCalled();
  await tick(30000);
  expect(loadTestRunContext).toHaveBeenCalledTimes(2);
  expect(run.execute).toHaveBeenCalledOnce();
});

it("skips an incompatible app while preserving its FIFO order", async () => {
  h.settings.enableParallelTestRuns = true;
  h.settings.maxConcurrentTestRuns = 3;
  h.databaseKey = "supabase:shared";
  const active = enqueue(1);
  await tick();
  h.branch = "other";
  const blocked = enqueue(1);
  const sibling = enqueue(1);
  await tick();
  // The independent app does not share the database that blocks app 1.
  vi.mocked(loadTestRunContext).mockImplementation(async ({ appId }) => ({
    workspaceKey: `/app-${appId}`,
    databaseKey: appId === 1 ? "supabase:shared" : undefined,
    branch: "other",
    revision: "abcdef",
    exclusive: false,
  }));
  const independent = enqueue(2);
  await tick();
  expect(independent.execute).toHaveBeenCalledOnce();
  expect(blocked.execute).not.toHaveBeenCalled();
  expect(sibling.execute).not.toHaveBeenCalled();
  expect(service.getAppTestRunQueue(1).queuedRuns[1].queuedReason).toBe(
    "earlier-run",
  );
  active.finish();
  await active.result;
  await tick();
  expect(blocked.execute).toHaveBeenCalledOnce();
  expect(sibling.execute).toHaveBeenCalledOnce();
  expect(blocked.execute.mock.invocationCallOrder[0]).toBeLessThan(
    sibling.execute.mock.invocationCallOrder[0],
  );
});

it.each(["independent", "workspace", "database"])(
  "scopes exclusive setup to shared resources (%s)",
  async (sharing) => {
    h.settings.enableParallelTestRuns = true;
    h.exclusive = true;
    if (sharing === "database") h.databaseKey = "supabase:shared";
    enqueue(1);
    await tick();
    if (sharing === "workspace")
      vi.mocked(loadTestRunContext).mockImplementationOnce(async () => ({
        workspaceKey: "/app-1",
        exclusive: true,
      }));
    const other = enqueue(2);
    await tick();
    if (sharing === "independent") {
      expect(other.execute).toHaveBeenCalledOnce();
      await expect(
        service.validateTestRunInputs(
          service.getAppTestRunQueue(2).activeRun!.runId,
        ),
      ).resolves.toBeUndefined();
    } else expect(other.execute).not.toHaveBeenCalled();
  },
);

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
  loaded({ workspaceKey: "/app-1", exclusive: false });
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
  expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toBe(
    "process-cleanup",
  );
  const reads = vi.mocked(loadTestRunContext).mock.calls.length;
  await tick(6000);
  expect(loadTestRunContext).toHaveBeenCalledTimes(reads);
  h.remainingProcesses = [];
  await tick(2000);
  expect(second.execute).toHaveBeenCalledOnce();
});

it("keeps serial apps independent and does not load unused admission metadata", async () => {
  const first = enqueue(1);
  const queued = enqueue(1);
  const other = enqueue(2);
  await tick(6000);
  expect(first.execute).toHaveBeenCalledOnce();
  expect(other.execute).toHaveBeenCalledOnce();
  expect(queued.execute).not.toHaveBeenCalled();
  expect(loadTestRunContext).not.toHaveBeenCalled();
  await service.validateTestRunInputs(
    service.getAppTestRunQueue(1).activeRun!.runId,
  );
  expect(loadTestRunContext).not.toHaveBeenCalled();
  first.finish();
  await first.result;
  expect(queued.execute).toHaveBeenCalledOnce();
});

it("counts unsettled owners against the global run limit until their processes close", async () => {
  h.settings.enableParallelTestRuns = true;
  h.settings.maxConcurrentTestRuns = 2;
  const first = enqueue(1);
  await tick();
  h.remainingProcesses = [{}];
  first.finish();
  await first.result;
  const other = enqueue(2);
  const queued = enqueue(3);
  await tick();
  expect(other.execute).toHaveBeenCalledOnce();
  expect(queued.execute).not.toHaveBeenCalled();
  expect(service.getAppTestRunQueue(3).queuedRuns[0].queuedReason).toBe(
    "capacity",
  );
  h.remainingProcesses = [];
  await tick(2000);
  expect(queued.execute).toHaveBeenCalledOnce();
});

it.each(["independent", "workspace", "database"])(
  "scopes lingering-process admission blocks to shared resources (%s)",
  async (sharing) => {
    h.settings.enableParallelTestRuns = true;
    if (sharing === "database") h.databaseKey = "supabase:shared";
    const first = enqueue(1);
    await tick();
    h.remainingProcesses = [{}];
    first.finish();
    await first.result;
    const sameApp = enqueue(1);
    if (sharing === "workspace") {
      vi.mocked(loadTestRunContext).mockImplementationOnce(async () => ({
        workspaceKey: "/app-1",
        exclusive: false,
      }));
    }
    const otherApp = enqueue(2);
    await tick();
    expect(sameApp.execute).not.toHaveBeenCalled();
    expect(service.getAppTestRunQueue(1).queuedRuns[0].queuedReason).toBe(
      "process-cleanup",
    );
    if (sharing === "independent")
      expect(otherApp.execute).toHaveBeenCalledOnce();
    else {
      expect(otherApp.execute).not.toHaveBeenCalled();
      expect(service.getAppTestRunQueue(2).queuedRuns[0].queuedReason).toBe(
        "process-cleanup",
      );
    }
    h.remainingProcesses = [];
    await tick(2000);
    expect(sameApp.execute).toHaveBeenCalledOnce();
    expect(otherApp.execute).toHaveBeenCalledOnce();
  },
);

it("does not reload contexts while all parallel slots are occupied", async () => {
  h.settings.enableParallelTestRuns = true;
  enqueue();
  enqueue();
  enqueue();
  await tick();
  expect(loadTestRunContext).toHaveBeenCalledTimes(2);
  await tick(10000);
  expect(loadTestRunContext).toHaveBeenCalledTimes(2);
});

it("refuses a changed shared database revision while a sibling is active", async () => {
  h.settings.enableParallelTestRuns = true;
  h.databaseKey = "supabase:shared";
  enqueue();
  enqueue();
  await tick();
  const runId = service.getAppTestRunQueue(1).activeRuns[1].runId;
  h.branch = "different";
  await expect(service.validateTestRunInputs(runId)).rejects.toThrow(
    "no longer compatible",
  );
});

it("dismisses only the observed blocked notice and preserves live waits", async () => {
  enqueue();
  await tick();
  const runId = service.getAppTestRunQueue(1).activeRun!.runId;
  service.setNeonBranchLimit(runId, "project", "blocked");
  service.dismissNeonBranchLimit(1, runId - 1);
  expect(service.getAppTestRunQueue(1).neonBranchLimit?.status).toBe("blocked");
  service.dismissNeonBranchLimit(1, runId);
  expect(service.getAppTestRunQueue(1).neonBranchLimit).toBeUndefined();
  service.setNeonBranchLimit(runId, "project", "waiting");
  service.dismissNeonBranchLimit(1, runId);
  expect(service.getAppTestRunQueue(1).neonBranchLimit?.status).toBe("waiting");
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
  loaded({ workspaceKey: "/app-1", exclusive: false });
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

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppRunInvocationRef } from "@/app_run/state";
import type { RuntimeMode2 } from "@/lib/schemas";
import type { RunningAppInfo } from "@/ipc/utils/process_manager";
import {
  AppRuntimeService,
  type AppRuntimeOutput,
  type AppRuntimeServiceDependencies,
  type ReadyAppRuntime,
} from "./app_runtime_service";

const APP_ID = 42;
const REF: AppRunInvocationRef = {
  kind: "app-run",
  entityKey: APP_ID,
  operationId: "app-run:test",
};
const READY_RUNTIME: ReadyAppRuntime = {
  proxyUrl: "http://localhost:3000",
  originalUrl: "http://localhost:5173",
  mode: "host",
};

function deferredReady() {
  let resolve!: (runtime: ReadyAppRuntime) => void;
  const promise = new Promise<ReadyAppRuntime>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createOutput() {
  const sent: unknown[] = [];
  const output: AppRuntimeOutput = {
    send: (value) => sent.push(value),
    enqueue: (value) => sent.push(value),
    flush: vi.fn(),
  };
  return { output, sent };
}

function createHarness() {
  const calls: string[] = [];
  let running: RunningAppInfo | undefined;
  let runtimeMode: RuntimeMode2 = "host";
  let id = 0;
  const dependencies: AppRuntimeServiceDependencies = {
    withLock: async (_appId, operation) => {
      calls.push("lock");
      return operation();
    },
    findApp: vi.fn(async () => ({
      id: APP_ID,
      path: "test-app",
      neonProjectId: null,
      installCommand: null,
      startCommand: null,
    })),
    resolveAppPath: (relativePath) => `/apps/${relativePath}`,
    getRunningApp: () => running,
    deleteRunningApp: () => {
      calls.push("delete");
      running = undefined;
    },
    getProcessCounter: () => running?.processId ?? 0,
    startProcess: vi.fn(async (input) => {
      calls.push(`start:${input.invocationRef?.operationId ?? "legacy"}`);
      running = {
        process: null,
        processId: 1,
        invocationRef: input.invocationRef,
        mode: "host",
        output: input.output,
        lastViewedAt: 0,
      };
    }),
    stopProcess: vi.fn(async () => {
      calls.push("stop");
      running = undefined;
    }),
    removeCurrentProcess: vi.fn(),
    cleanPort: vi.fn(async () => {
      calls.push("clean-port");
    }),
    restartSandbox: vi.fn(),
    ensureProxy: vi.fn(),
    startCloudLogs: vi.fn(),
    clearLogs: vi.fn(() => {
      calls.push("clear-logs");
    }),
    readRuntimeMode: () => runtimeMode,
    removeNodeModules: vi.fn(async () => {
      calls.push("remove-node-modules");
    }),
    removeDockerVolumes: vi.fn(),
    waitForReady: vi.fn(async () => {
      calls.push("ready");
      return READY_RUNTIME;
    }),
    createId: () => `id-${++id}`,
    now: () => 123,
  };
  return {
    calls,
    dependencies,
    service: new AppRuntimeService(dependencies),
    setRunning(value: RunningAppInfo | undefined) {
      running = value;
    },
    setRuntimeMode(value: RuntimeMode2) {
      runtimeMode = value;
    },
  };
}

describe("AppRuntimeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes start, restart, and stop through one lifecycle seam", async () => {
    const harness = createHarness();
    const { output } = createOutput();

    await harness.service.start({ appId: APP_ID, output, invocationRef: REF });
    await harness.service.restart({
      appId: APP_ID,
      output,
      invocationRef: REF,
      removeNodeModules: true,
      clearRuntimeLogs: true,
    });
    await harness.service.stop(APP_ID);

    expect(harness.calls).toEqual([
      "lock",
      "clean-port",
      "start:app-run:test",
      "lock",
      "stop",
      "clean-port",
      "remove-node-modules",
      "clear-logs",
      "start:app-run:test",
      "lock",
      "stop",
    ]);
  });

  it("binds a cached proxy response to the requesting invocation", async () => {
    const harness = createHarness();
    const { output, sent } = createOutput();
    harness.setRunning({
      process: null,
      processId: 1,
      invocationRef: {
        ...REF,
        operationId: "app-run:producer",
      },
      mode: "host",
      output,
      proxyUrl: "http://localhost:42042",
      originalUrl: "http://localhost:32042",
      lastViewedAt: 0,
    });

    await harness.service.start({ appId: APP_ID, output, invocationRef: REF });

    expect(sent).toContainEqual(
      expect.objectContaining({
        invocationRef: REF,
        message: expect.stringContaining("http://localhost:42042"),
      }),
    );
    expect(harness.dependencies.startProcess).not.toHaveBeenCalled();
  });

  it("snapshots runtime mode before removing dependencies during rebuild", async () => {
    const harness = createHarness();
    const { output } = createOutput();
    harness.setRuntimeMode("docker");
    vi.mocked(harness.dependencies.removeNodeModules).mockImplementation(
      async () => {
        harness.setRuntimeMode("host");
      },
    );

    await harness.service.restart({
      appId: APP_ID,
      output,
      invocationRef: REF,
      removeNodeModules: true,
    });

    expect(harness.dependencies.removeDockerVolumes).toHaveBeenCalledWith(
      APP_ID,
    );
  });

  it("owns external lifecycle claims from start through readiness", async () => {
    const harness = createHarness();
    const { output, sent } = createOutput();

    await harness.service.executeExternalLifecycle({
      appId: APP_ID,
      output,
      operation: "rebuild",
      invocationRef: REF,
      timeoutMs: 600_000,
    });

    expect(sent).toEqual([
      expect.objectContaining({
        type: "agent-lifecycle-started",
        invocationRef: REF,
        lifecycleRequestId: "id-1",
      }),
      expect.objectContaining({
        type: "agent-lifecycle-succeeded",
        invocationRef: REF,
        lifecycleRequestId: "id-1",
      }),
    ]);
    expect(harness.calls).toEqual([
      "lock",
      "clean-port",
      "remove-node-modules",
      "clear-logs",
      "start:app-run:test",
      "ready",
    ]);
    expect(harness.dependencies.waitForReady).toHaveBeenCalledWith(
      APP_ID,
      600_000,
    );
  });

  it("marks readiness failure as potentially retaining a live runtime", async () => {
    const harness = createHarness();
    const { output, sent } = createOutput();
    vi.mocked(harness.dependencies.waitForReady).mockRejectedValue(
      new Error("readiness timed out"),
    );

    await expect(
      harness.service.executeExternalLifecycle({
        appId: APP_ID,
        output,
        operation: "restart",
        invocationRef: REF,
      }),
    ).rejects.toThrow("readiness timed out");

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "agent-lifecycle-failed",
        lifecycleRuntimeMayBeLive: true,
      }),
    );
  });

  it("does not mark restart failure as retaining a live runtime", async () => {
    const harness = createHarness();
    const { output, sent } = createOutput();
    vi.mocked(harness.dependencies.startProcess).mockRejectedValue(
      new Error("spawn failed"),
    );

    await expect(
      harness.service.executeExternalLifecycle({
        appId: APP_ID,
        output,
        operation: "restart",
        invocationRef: REF,
      }),
    ).rejects.toThrow("spawn failed");

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "agent-lifecycle-failed",
        lifecycleRuntimeMayBeLive: false,
      }),
    );
  });

  it("does not reuse identity when the runtime exits during readiness", async () => {
    const harness = createHarness();
    const { output, sent } = createOutput();
    vi.mocked(harness.dependencies.waitForReady).mockImplementation(
      async () => {
        harness.setRunning(undefined);
        throw new Error("process exited before readiness");
      },
    );

    await expect(
      harness.service.executeExternalLifecycle({
        appId: APP_ID,
        output,
        operation: "restart",
        invocationRef: REF,
      }),
    ).rejects.toThrow("process exited before readiness");

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "agent-lifecycle-failed",
        lifecycleRuntimeMayBeLive: false,
      }),
    );
  });

  it("settles the real outcome when abort happens after restart begins", async () => {
    const harness = createHarness();
    const { output, sent } = createOutput();
    const abortController = new AbortController();
    const ready = deferredReady();
    vi.mocked(harness.dependencies.waitForReady).mockImplementation(
      async () => ready.promise,
    );

    const execution = harness.service.executeExternalLifecycle({
      appId: APP_ID,
      output,
      operation: "restart",
      invocationRef: REF,
      abortSignal: abortController.signal,
    });
    await vi.waitFor(() =>
      expect(harness.dependencies.waitForReady).toHaveBeenCalledTimes(1),
    );

    abortController.abort();
    ready.resolve(READY_RUNTIME);
    await execution;

    expect(sent).toEqual([
      expect.objectContaining({ type: "agent-lifecycle-started" }),
      expect.objectContaining({ type: "agent-lifecycle-succeeded" }),
    ]);
  });

  it("settles concurrent external lifecycle claims independently", async () => {
    const harness = createHarness();
    const first = createOutput();
    const second = createOutput();
    const ready = deferredReady();
    vi.mocked(harness.dependencies.waitForReady).mockImplementation(
      async () => ready.promise,
    );
    const secondRef: AppRunInvocationRef = {
      ...REF,
      operationId: "app-run:second",
    };

    const firstExecution = harness.service.executeExternalLifecycle({
      appId: APP_ID,
      output: first.output,
      operation: "restart",
      invocationRef: REF,
    });
    const secondExecution = harness.service.executeExternalLifecycle({
      appId: APP_ID,
      output: second.output,
      operation: "restart",
      invocationRef: secondRef,
    });
    await vi.waitFor(() =>
      expect(harness.dependencies.waitForReady).toHaveBeenCalledTimes(2),
    );
    ready.resolve(READY_RUNTIME);
    await Promise.all([firstExecution, secondExecution]);

    expect(first.sent).toContainEqual(
      expect.objectContaining({
        type: "agent-lifecycle-succeeded",
        invocationRef: REF,
      }),
    );
    expect(second.sent).toContainEqual(
      expect.objectContaining({
        type: "agent-lifecycle-succeeded",
        invocationRef: secondRef,
      }),
    );
  });

  it("retains cancel-before-claim tombstones", () => {
    const harness = createHarness();
    const { output, sent } = createOutput();

    harness.service.cancelExternalLifecycle(REF);
    const claim = harness.service.claimExternalLifecycle({
      appId: APP_ID,
      output,
      operation: "restart",
      invocationRef: REF,
    });

    expect(claim).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it("cleans up active claims so late settlements cannot publish", () => {
    const harness = createHarness();
    const { output, sent } = createOutput();
    const claim = harness.service.claimExternalLifecycle({
      appId: APP_ID,
      output,
      operation: "restart",
      invocationRef: REF,
    });

    harness.service.cleanup(APP_ID);
    harness.service.cancelExternalLifecycle(REF);

    expect(claim).toBeDefined();
    expect(sent).toHaveLength(1);
  });

  it("cleans up all claims so late lifecycle settlements cannot publish", async () => {
    const harness = createHarness();
    const first = createOutput();
    const second = createOutput();
    const ready = deferredReady();
    vi.mocked(harness.dependencies.waitForReady).mockImplementation(
      async () => ready.promise,
    );
    const secondRef: AppRunInvocationRef = {
      kind: "app-run",
      entityKey: APP_ID + 1,
      operationId: "app-run:other-app",
    };

    const executions = [
      harness.service.executeExternalLifecycle({
        appId: APP_ID,
        output: first.output,
        operation: "restart",
        invocationRef: REF,
      }),
      harness.service.executeExternalLifecycle({
        appId: APP_ID + 1,
        output: second.output,
        operation: "restart",
        invocationRef: secondRef,
      }),
    ];
    await vi.waitFor(() =>
      expect(harness.dependencies.waitForReady).toHaveBeenCalledTimes(2),
    );

    harness.service.cleanupAll();
    ready.resolve(READY_RUNTIME);
    await Promise.all(executions);

    expect(first.sent).toEqual([
      expect.objectContaining({ type: "agent-lifecycle-started" }),
    ]);
    expect(second.sent).toEqual([
      expect.objectContaining({ type: "agent-lifecycle-started" }),
    ]);
  });
});

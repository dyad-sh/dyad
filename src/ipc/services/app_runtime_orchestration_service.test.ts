import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppRunInvocationRef } from "@/app_run/state";
import type { RuntimeMode2 } from "@/lib/schemas";
import type { RunningAppInfo } from "@/ipc/utils/process_manager";
import { runningApps } from "@/ipc/utils/process_manager";
import {
  AppRuntimeService,
  appRuntimeService,
  getAppRuntimeOperationResources,
  reconcileRunningSupabasePreview,
  type AppRuntimeOutput,
  type AppRuntimeServiceDependencies,
} from "./app_runtime_service";
import {
  AppOperationCoordinator,
  readAppResource,
} from "./app_operation_coordinator";
import {
  ensureSupabasePreviewRedirects,
  resolveSupabasePreviewTarget,
  type SupabasePreviewTarget,
} from "./supabase_preview_redirect_service";

vi.mock("./supabase_preview_redirect_service", () => ({
  ensureSupabasePreviewRedirects: vi.fn().mockResolvedValue(undefined),
  resolveSupabasePreviewTarget: vi.fn().mockResolvedValue(null),
}));

const APP_ID = 42;
const REF: AppRunInvocationRef = {
  kind: "app-run",
  entityKey: APP_ID,
  operationId: "app-run:test",
};

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
    runSerialized: async (_appId, lifecycle, operation) => {
      calls.push(`lock:${lifecycle}`);
      try {
        return await operation();
      } finally {
        calls.push(`unlock:${lifecycle}`);
      }
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
    addLog: vi.fn(),
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

  it("lets Stop release pending startup readiness without failing Run", async () => {
    const harness = createHarness();
    const coordinator = new AppOperationCoordinator();
    const { output } = createOutput();
    harness.dependencies.runSerialized = (appId, lifecycle, operation) =>
      coordinator.run(
        {
          appId,
          operation: lifecycle,
          resources: getAppRuntimeOperationResources(lifecycle),
        },
        operation,
      );
    vi.mocked(harness.dependencies.startProcess).mockImplementation(
      async () => {
        const appInfo: RunningAppInfo = {
          process: null,
          processId: 1,
          mode: "host",
          lastViewedAt: 0,
          proxyAbortController: new AbortController(),
        };
        harness.setRunning(appInfo);
        runningApps.set(APP_ID, appInfo);
      },
    );
    vi.mocked(harness.dependencies.waitForReady).mockImplementation((appId) =>
      appRuntimeService.waitForReady(appId, { timeoutMs: 1000 }),
    );
    const start = harness.service.start({ appId: APP_ID, output });
    try {
      await vi.waitFor(() =>
        expect(harness.dependencies.waitForReady).toHaveBeenCalledOnce(),
      );
      const stop = harness.service.stop(APP_ID);
      await expect(start).resolves.toBeUndefined();
      await expect(stop).resolves.toBeUndefined();
      expect(harness.dependencies.stopProcess).toHaveBeenCalledOnce();
    } finally {
      runningApps.delete(APP_ID);
    }
  });

  it("claims only the resources each lifecycle operation touches", () => {
    expect(getAppRuntimeOperationResources("stop")).toEqual(["runtime"]);
    expect(getAppRuntimeOperationResources("start")).toEqual([
      { resource: "app-path", mode: "read" },
      "runtime",
      { resource: "runtime-config", mode: "read" },
    ]);
    expect(getAppRuntimeOperationResources("restart")).toEqual([
      { resource: "app-path", mode: "read" },
      "runtime",
      { resource: "runtime-config", mode: "read" },
    ]);
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
    });
    await harness.service.stop(APP_ID);

    expect(harness.calls).toEqual([
      "lock:start",
      "clean-port",
      "start:app-run:test",
      "ready",
      "unlock:start",
      "lock:restart",
      "stop",
      "clean-port",
      "remove-node-modules",
      "start:app-run:test",
      "ready",
      "unlock:restart",
      "lock:stop",
      "stop",
      "unlock:stop",
    ]);
  });

  describe.each(["start", "restart", "rebuild"] as const)(
    "%s admission",
    (lifecycle) => {
      it.each(["setup", "readiness"] as const)(
        "allows chat checkpoint and Supabase reconciliation during %s",
        async (phase) => {
          const harness = createHarness();
          const coordinator = new AppOperationCoordinator();
          const { output } = createOutput();
          let release!: () => void;
          const pending = new Promise<void>((resolve) => {
            release = resolve;
          });
          const blockedStep = vi.mocked(
            phase === "setup"
              ? harness.dependencies.startProcess
              : harness.dependencies.waitForReady,
          );
          blockedStep.mockImplementation(async () => pending);
          harness.dependencies.runSerialized = (appId, lifecycle, operation) =>
            coordinator.run(
              {
                appId,
                operation: `runtime:${lifecycle}`,
                resources: getAppRuntimeOperationResources(lifecycle),
              },
              operation,
            );

          const runtimeOperation = harness.service[
            lifecycle === "start" ? "start" : "restart"
          ]({
            appId: APP_ID,
            output,
            removeNodeModules: lifecycle === "rebuild",
          });
          await vi.waitFor(() => expect(blockedStep).toHaveBeenCalledOnce());

          const repositoryWriter = vi.fn();
          const checkpoint = coordinator.run(
            {
              appId: APP_ID,
              operation: "chat-checkpoint",
              resources: [readAppResource("app-path"), "repository"],
            },
            async () => repositoryWriter(),
          );
          const providerWriter = vi.fn();
          const reconciliation = coordinator.run(
            {
              appId: APP_ID,
              operation: "reconcile Local Agent Supabase functions",
              resources: [readAppResource("app-path"), "provider"],
            },
            async () => providerWriter(),
          );
          try {
            await vi.waitFor(() => {
              expect(repositoryWriter).toHaveBeenCalledOnce();
              expect(providerWriter).toHaveBeenCalledOnce();
            });
            expect(coordinator.isBusy(APP_ID, ["runtime-config"])).toBe(true);
          } finally {
            release();
            await Promise.all([runtimeOperation, checkpoint, reconciliation]);
          }
        },
      );
    },
  );

  it("keeps a spawned process tracked when readiness times out", async () => {
    const harness = createHarness();
    const { output } = createOutput();
    vi.mocked(harness.dependencies.waitForReady).mockRejectedValue(
      new Error("readiness timed out"),
    );

    await expect(
      harness.service.start({ appId: APP_ID, output }),
    ).rejects.toThrow("readiness timed out");

    expect(harness.calls).not.toContain("delete");
    expect(harness.service.isRunning(APP_ID)).toBe(true);
  });

  it("preserves a connect then disconnect during an in-place cloud restart lookup", async () => {
    const harness = createHarness();
    const { output } = createOutput();
    const appInfo: RunningAppInfo = {
      process: null,
      processId: 8,
      mode: "cloud",
      lastViewedAt: 0,
      cloudSandboxId: "sandbox",
      proxyUrl: "http://app-42.localhost:42142",
      originalUrl: "https://preview.example.test",
      previewAuthTarget: null,
      output,
    };
    harness.setRunning(appInfo);
    runningApps.set(APP_ID, appInfo);
    vi.mocked(harness.dependencies.restartSandbox).mockResolvedValue({
      previewUrl: "https://preview.example.test",
      previewAuthToken: "preview-token",
    });
    let finishLookup!: (target: SupabasePreviewTarget) => void;
    vi.mocked(resolveSupabasePreviewTarget).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    const target = { projectId: "project", organizationSlug: "org" };
    const restart = harness.service.restart({ appId: APP_ID, output });
    try {
      await vi.waitFor(() =>
        expect(resolveSupabasePreviewTarget).toHaveBeenCalledOnce(),
      );
      vi.mocked(resolveSupabasePreviewTarget).mockResolvedValueOnce(target);
      await reconcileRunningSupabasePreview(APP_ID);
      vi.mocked(resolveSupabasePreviewTarget).mockResolvedValueOnce(null);
      await reconcileRunningSupabasePreview(APP_ID);
      vi.mocked(ensureSupabasePreviewRedirects).mockClear();
      finishLookup(target);
      await restart;
      expect(appInfo.previewAuthTarget).toBeNull();
      expect(ensureSupabasePreviewRedirects).not.toHaveBeenCalled();
    } finally {
      finishLookup?.(target);
      await restart;
      appInfo.proxyAbortController?.abort();
      await appInfo.previewAuthRegistration?.settled;
      runningApps.delete(APP_ID);
    }
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
      "lock:restart",
      "clean-port",
      "remove-node-modules",
      "start:app-run:test",
      "ready",
      "unlock:restart",
    ]);
    expect(harness.dependencies.waitForReady).toHaveBeenCalledWith(
      APP_ID,
      600_000,
    );
    expect(harness.dependencies.addLog).toHaveBeenCalledWith({
      type: "server",
      level: "info",
      message: "Rebuilding app",
      sourceName: "Dyad",
      appId: APP_ID,
      timestamp: 123,
      runtimeBoundary: "rebuild",
    });
    expect(harness.dependencies.clearLogs).not.toHaveBeenCalled();
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
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    vi.mocked(harness.dependencies.waitForReady).mockImplementation(
      async () => ready,
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
    releaseReady();
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
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    vi.mocked(harness.dependencies.waitForReady).mockImplementation(
      async () => ready,
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
    releaseReady();
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
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    vi.mocked(harness.dependencies.waitForReady).mockImplementation(
      async () => ready,
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
    releaseReady();
    await Promise.all(executions);

    expect(first.sent).toEqual([
      expect.objectContaining({ type: "agent-lifecycle-started" }),
    ]);
    expect(second.sent).toEqual([
      expect.objectContaining({ type: "agent-lifecycle-started" }),
    ]);
  });
});

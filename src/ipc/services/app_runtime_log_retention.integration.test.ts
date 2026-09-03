import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppRunInvocationRef } from "@/app_run/state";
import type { ConsoleEntry } from "@/ipc/types";
import { addLog, clearLogs } from "@/lib/log_store";
import type { AgentContext } from "@/pro/main/ipc/handlers/local_agent/tools/types";

const APP_ID = 42;
const NOW = Date.now();
const REF: AppRunInvocationRef = {
  kind: "app-run",
  entityKey: APP_ID,
  operationId: "restart-for-log-test",
};

const mocks = vi.hoisted(() => ({
  findChat: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      chats: { findFirst: mocks.findChat },
    },
  },
}));

import {
  AppRuntimeService,
  type AppRuntimeOutput,
  type AppRuntimeServiceDependencies,
} from "./app_runtime_service";
import { readLogsTool } from "@/pro/main/ipc/handlers/local_agent/tools/read_logs";

function createService(): AppRuntimeService {
  let running = false;
  const dependencies: AppRuntimeServiceDependencies = {
    runSerialized: async (_appId, _lifecycle, operation) => operation(),
    findApp: vi.fn(async () => ({
      id: APP_ID,
      path: "test-app",
      neonProjectId: null,
      installCommand: null,
      startCommand: null,
    })),
    resolveAppPath: (relativePath) => `/apps/${relativePath}`,
    getRunningApp: () =>
      running
        ? {
            process: null,
            processId: 1,
            invocationRef: REF,
            mode: "host",
            output: { send: vi.fn(), enqueue: vi.fn(), flush: vi.fn() },
            lastViewedAt: NOW,
          }
        : undefined,
    deleteRunningApp: () => {
      running = false;
    },
    getProcessCounter: () => 1,
    startProcess: vi.fn(async () => {
      running = true;
    }),
    stopProcess: vi.fn(async () => {
      running = false;
    }),
    removeCurrentProcess: vi.fn(),
    cleanPort: vi.fn(),
    restartSandbox: vi.fn(),
    ensureProxy: vi.fn(),
    startCloudLogs: vi.fn(),
    addLog,
    clearLogs,
    readRuntimeMode: () => "host",
    removeNodeModules: vi.fn(),
    removeDockerVolumes: vi.fn(),
    waitForReady: vi.fn(),
    createId: () => "lifecycle-request-1",
    now: () => NOW,
  };
  return new AppRuntimeService(dependencies);
}

describe("app runtime log retention (integration)", () => {
  beforeEach(() => {
    clearLogs(APP_ID);
    mocks.findChat.mockResolvedValue({ app: { id: APP_ID } });
  });

  afterEach(() => {
    clearLogs(APP_ID);
  });

  it("lets read_logs inspect entries from before an agent restart", async () => {
    const beforeRestart: ConsoleEntry = {
      type: "client",
      level: "error",
      message: "Error captured before restart",
      appId: APP_ID,
      timestamp: NOW - 100,
    };
    addLog(beforeRestart);

    const output: AppRuntimeOutput = {
      send: vi.fn(),
      enqueue: vi.fn(),
      flush: vi.fn(),
    };
    await createService().executeExternalLifecycle({
      appId: APP_ID,
      output,
      operation: "restart",
      invocationRef: REF,
    });

    const onXmlComplete = vi.fn();
    const result = await readLogsTool.execute(
      {
        type: "client",
        level: "error",
        searchTerm: "captured",
        limit: 1,
      },
      {
        chatId: 7,
        onXmlComplete,
      } as unknown as AgentContext,
    );

    expect(result).toContain("Error captured before restart");
    expect(result).toContain("App restart started");
    expect(result.indexOf("Error captured before restart")).toBeLessThan(
      result.indexOf("App restart started"),
    );
    expect(onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('type="client" level="error" count="2"'),
    );
  });
});

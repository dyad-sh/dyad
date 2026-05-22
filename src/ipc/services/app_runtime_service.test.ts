import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { safeSendMock, spawnMock } = vi.hoisted(() => ({
  safeSendMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  default: {
    spawn: spawnMock,
  },
  spawn: spawnMock,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("fix-path", () => ({
  default: vi.fn(),
}));

vi.mock("kill-port", () => ({
  default: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    runtimeMode2: "host",
  }),
}));

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: (...args: unknown[]) => safeSendMock(...args),
}));

vi.mock("@/ipc/utils/socket_firewall", () => ({
  ensurePnpmAllowBuildsConfigured: vi.fn(),
  getPnpmMinimumReleaseAgeSupport: vi.fn(async () => ({
    supported: false,
  })),
  PNPM_INSTALL_POLICY_ARGS: ["--minimum-release-age=1440"],
}));

vi.mock("@/ipc/utils/cloud_sandbox_provider", () => ({
  buildCloudSandboxFileMap: vi.fn(),
  CloudSandboxApiError: class CloudSandboxApiError extends Error {
    code?: string;
    status?: number;
  },
  createCloudSandbox: vi.fn(),
  destroyCloudSandbox: vi.fn(),
  registerRunningCloudSandbox: vi.fn(),
  setCloudSandboxSyncUpdateListener: vi.fn(),
  stopCloudSandboxFileSync: vi.fn(),
  streamCloudSandboxLogs: vi.fn(),
  unregisterRunningCloudSandbox: vi.fn(),
  uploadCloudSandboxFiles: vi.fn(),
}));

import { executeApp } from "./app_runtime_service";
import { processCounter, runningApps } from "@/ipc/utils/process_manager";

class FakeChildProcess extends EventEmitter {
  pid: number;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = {
    write: vi.fn(),
  };

  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

function createEvent(): Electron.IpcMainInvokeEvent {
  const sender = {
    isDestroyed: () => false,
    isCrashed: () => false,
    send: vi.fn(),
  } as unknown as WebContents;

  return { sender } as IpcMainInvokeEvent;
}

describe("executeApp", () => {
  beforeEach(() => {
    runningApps.clear();
    processCounter.value = 0;
    safeSendMock.mockReset();
    spawnMock.mockReset();
  });

  it("does not emit app-exit when a replaced process closes later", async () => {
    const firstProcess = new FakeChildProcess(101);
    const secondProcess = new FakeChildProcess(102);
    spawnMock
      .mockReturnValueOnce(firstProcess)
      .mockReturnValueOnce(secondProcess);

    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      event: createEvent(),
      isNeon: false,
    });
    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      event: createEvent(),
      isNeon: false,
    });

    firstProcess.emit("close", 1, null);

    expect(safeSendMock).not.toHaveBeenCalledWith(
      expect.anything(),
      "app:output",
      expect.objectContaining({ type: "app-exit" }),
    );
    expect(runningApps.get(1)?.process).toBe(
      secondProcess as unknown as ChildProcess,
    );
  });

  it("emits app-exit when the current process closes", async () => {
    const process = new FakeChildProcess(101);
    spawnMock.mockReturnValueOnce(process);

    const event = createEvent();
    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      event,
      isNeon: false,
    });

    process.emit("close", 1, null);

    expect(safeSendMock).toHaveBeenCalledWith(
      event.sender,
      "app:output",
      expect.objectContaining({
        type: "app-exit",
        appId: 1,
        exitCode: 1,
        signal: null,
      }),
    );
    expect(runningApps.has(1)).toBe(false);
  });
});

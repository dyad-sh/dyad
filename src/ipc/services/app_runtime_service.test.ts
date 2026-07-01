import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getPnpmMinimumReleaseAgeSupportMock,
  ensurePnpmAllowBuildsConfiguredMock,
  readSettingsMock,
  safeSendMock,
  spawnMock,
  killPortMock,
  startProxyMock,
} = vi.hoisted(() => ({
  getPnpmMinimumReleaseAgeSupportMock: vi.fn<
    () => Promise<{
      available: boolean;
      minimumReleaseAgeSupported: boolean;
      warningMessage?: string;
    }>
  >(async () => ({
    available: false,
    minimumReleaseAgeSupported: false,
  })),
  ensurePnpmAllowBuildsConfiguredMock:
    vi.fn<(args: unknown) => Promise<{ changed: boolean }>>(),
  readSettingsMock: vi.fn<() => Record<string, unknown>>(() => ({
    runtimeMode2: "host",
  })),
  safeSendMock: vi.fn(),
  spawnMock: vi.fn(),
  killPortMock: vi.fn<() => Promise<void>>(async () => {}),
  startProxyMock: vi.fn(),
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
  default: killPortMock,
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => readSettingsMock(),
}));

vi.mock("@/ipc/utils/safe_sender", () => ({
  safeSend: (...args: unknown[]) => safeSendMock(...args),
}));

vi.mock("@/ipc/utils/socket_firewall", () => ({
  ensurePnpmAllowBuildsConfigured: (args: unknown) =>
    ensurePnpmAllowBuildsConfiguredMock(args),
  getPackageManagerCommandEnv: () => ({
    ...process.env,
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    COREPACK_ENABLE_STRICT: "0",
    npm_config_pm_on_fail: "ignore",
  }),
  getPnpmMinimumReleaseAgeSupport: () => getPnpmMinimumReleaseAgeSupportMock(),
  PNPM_INSTALL_POLICY_ARGS: [
    "--pm-on-fail=ignore",
    "--minimum-release-age=1440",
  ],
  PNPM_PM_ON_FAIL_IGNORE_ARG: "--pm-on-fail=ignore",
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

vi.mock("@/ipc/utils/start_proxy_server", () => ({
  startProxy: (...args: unknown[]) => startProxyMock(...args),
}));

import { ensureProxyForRunningApp, executeApp } from "./app_runtime_service";
import { processCounter, runningApps } from "@/ipc/utils/process_manager";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

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

async function withCorepackProjectSpecEnv<T>(
  value: string,
  callback: () => Promise<T>,
): Promise<T> {
  const originalValue = process.env.COREPACK_ENABLE_PROJECT_SPEC;
  process.env.COREPACK_ENABLE_PROJECT_SPEC = value;
  try {
    return await callback();
  } finally {
    if (originalValue === undefined) {
      delete process.env.COREPACK_ENABLE_PROJECT_SPEC;
    } else {
      process.env.COREPACK_ENABLE_PROJECT_SPEC = originalValue;
    }
  }
}

describe("executeApp", () => {
  beforeEach(() => {
    runningApps.clear();
    processCounter.value = 0;
    getPnpmMinimumReleaseAgeSupportMock.mockReset();
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: false,
      minimumReleaseAgeSupported: false,
    });
    ensurePnpmAllowBuildsConfiguredMock.mockReset();
    ensurePnpmAllowBuildsConfiguredMock.mockResolvedValue({ changed: false });
    readSettingsMock.mockReset();
    readSettingsMock.mockReturnValue({
      runtimeMode2: "host",
    });
    safeSendMock.mockReset();
    spawnMock.mockReset();
    killPortMock.mockReset();
    killPortMock.mockResolvedValue(undefined);
    startProxyMock.mockReset();
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

  it("uses pnpm when pnpm is available but too old for minimumReleaseAge", async () => {
    const process = new FakeChildProcess(101);
    spawnMock.mockReturnValueOnce(process);
    getPnpmMinimumReleaseAgeSupportMock.mockResolvedValue({
      available: true,
      minimumReleaseAgeSupported: false,
      warningMessage:
        "Install pnpm 10.16.0 or newer for the strongest protection",
    });
    readSettingsMock.mockReturnValue({
      runtimeMode2: "host",
      enablePnpmMinimumReleaseAgeWarning: true,
    });

    const event = createEvent();
    await executeApp({
      appPath: "/tmp/app",
      appId: 1,
      event,
      isNeon: false,
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "pnpm --pm-on-fail=ignore --minimum-release-age=1440 install && pnpm --pm-on-fail=ignore run dev --port 32101",
      [],
      expect.objectContaining({
        cwd: "/tmp/app",
        env: expect.objectContaining({
          COREPACK_ENABLE_PROJECT_SPEC: "0",
          COREPACK_ENABLE_STRICT: "0",
          npm_config_pm_on_fail: "ignore",
        }),
        shell: true,
      }),
    );
    expect(ensurePnpmAllowBuildsConfiguredMock).toHaveBeenCalledWith({
      appPath: "/tmp/app",
    });
    expect(safeSendMock).toHaveBeenCalledWith(
      event.sender,
      "app:output",
      expect.objectContaining({
        type: "package-manager-warning",
        message: "Install pnpm 10.16.0 or newer for the strongest protection",
      }),
    );
  });

  it("does not disable Corepack project specs for npm fallback commands", async () => {
    await withCorepackProjectSpecEnv("1", async () => {
      const process = new FakeChildProcess(101);
      spawnMock.mockReturnValueOnce(process);

      await executeApp({
        appPath: "/tmp/app",
        appId: 1,
        event: createEvent(),
        isNeon: false,
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "(npm install --legacy-peer-deps && npm run dev -- --port 32101)",
        [],
        expect.objectContaining({
          cwd: "/tmp/app",
          env: expect.objectContaining({
            COREPACK_ENABLE_PROJECT_SPEC: "1",
          }),
          shell: true,
        }),
      );
      expect(ensurePnpmAllowBuildsConfiguredMock).not.toHaveBeenCalled();
    });
  });

  it("does not disable Corepack project specs for custom commands", async () => {
    await withCorepackProjectSpecEnv("1", async () => {
      const process = new FakeChildProcess(101);
      spawnMock.mockReturnValueOnce(process);

      await executeApp({
        appPath: "/tmp/app",
        appId: 1,
        event: createEvent(),
        isNeon: false,
        installCommand: "pnpm install --frozen-lockfile",
        startCommand: "pnpm run preview -- --port 32101",
      });

      expect(spawnMock).toHaveBeenCalledWith(
        "pnpm install --frozen-lockfile && pnpm run preview -- --port 32101",
        [],
        expect.objectContaining({
          cwd: "/tmp/app",
          env: expect.objectContaining({
            COREPACK_ENABLE_PROJECT_SPEC: "1",
          }),
          shell: true,
        }),
      );
      expect(getPnpmMinimumReleaseAgeSupportMock).not.toHaveBeenCalled();
      expect(ensurePnpmAllowBuildsConfiguredMock).not.toHaveBeenCalled();
    });
  });

  it("starts the proxy on the deterministic port without killing the occupant", async () => {
    const terminate = vi.fn();
    startProxyMock.mockImplementation(async (_originalUrl, opts) => {
      opts.onStarted?.("http://localhost:42142");
      return { terminate };
    });
    runningApps.set(42, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
    });

    const event = createEvent();
    await ensureProxyForRunningApp({
      appId: 42,
      event,
      originalUrl: "http://localhost:32142",
      mode: "host",
    });

    expect(startProxyMock).toHaveBeenCalledWith(
      "http://localhost:32142",
      expect.objectContaining({
        port: 42142,
      }),
    );
    // We must never evict whatever already holds the deterministic proxy port —
    // the worker scans the fallback band instead.
    expect(killPortMock).not.toHaveBeenCalledWith(42142, "tcp");
  });

  it("surfaces a proxy port-exhaustion error to the renderer", async () => {
    const terminate = vi.fn();
    startProxyMock.mockImplementation(async (_originalUrl, opts) => {
      opts.onError?.(new DyadError("all ports in use", DyadErrorKind.Conflict));
      return { terminate };
    });
    runningApps.set(42, {
      process: null,
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
    });

    const event = createEvent();
    await ensureProxyForRunningApp({
      appId: 42,
      event,
      originalUrl: "http://localhost:32142",
      mode: "host",
    });

    expect(safeSendMock).toHaveBeenCalledWith(
      expect.anything(),
      "app:output",
      expect.objectContaining({
        type: "stderr",
        message: expect.stringContaining("all ports in use"),
        appId: 42,
      }),
    );
  });
});

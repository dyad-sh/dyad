import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  destroyCloudSandboxMock,
  stopCloudSandboxFileSyncMock,
  unregisterRunningCloudSandboxMock,
  killProcessTreeSyncMock,
} = vi.hoisted(() => ({
  destroyCloudSandboxMock: vi.fn(),
  stopCloudSandboxFileSyncMock: vi.fn(),
  unregisterRunningCloudSandboxMock: vi.fn(),
  killProcessTreeSyncMock: vi.fn(),
}));

vi.mock("./cloud_sandbox_provider", () => ({
  destroyCloudSandbox: destroyCloudSandboxMock,
  stopCloudSandboxFileSync: stopCloudSandboxFileSyncMock,
  unregisterRunningCloudSandbox: unregisterRunningCloudSandboxMock,
}));

vi.mock("./kill_process_tree_sync", () => ({
  killProcessTreeSync: killProcessTreeSyncMock,
}));

import {
  getRunningAppProcessPids,
  runningApps,
  stopAppByInfo,
  stopAllAppsSync,
  type RunningAppInfo,
} from "./process_manager";

describe("stopAppByInfo", () => {
  beforeEach(() => {
    runningApps.clear();
    vi.clearAllMocks();
  });

  it("keeps cloud apps registered when sandbox teardown fails", async () => {
    destroyCloudSandboxMock.mockRejectedValueOnce(new Error("teardown failed"));
    const abortCloudLogs = vi.fn();
    const cloudLogAbortController = {
      abort: abortCloudLogs,
    } as unknown as AbortController;
    const terminateProxyWorker = vi.fn().mockResolvedValue(0);
    const proxyWorker = {
      terminate: terminateProxyWorker,
    } as unknown as NonNullable<RunningAppInfo["proxyWorker"]>;
    const appInfo: RunningAppInfo = {
      process: null,
      processId: 1,
      mode: "cloud",
      cloudSandboxId: "sandbox-1",
      lastViewedAt: Date.now(),
      cloudLogAbortController,
      proxyWorker,
    };

    runningApps.set(1, appInfo);

    await expect(stopAppByInfo(1, appInfo)).rejects.toThrow("teardown failed");

    expect(runningApps.get(1)).toBe(appInfo);
    expect(stopCloudSandboxFileSyncMock).toHaveBeenCalledWith(1);
    expect(unregisterRunningCloudSandboxMock).not.toHaveBeenCalled();
    expect(terminateProxyWorker).not.toHaveBeenCalled();
    expect(abortCloudLogs).not.toHaveBeenCalled();
  });

  it("removes cloud apps after sandbox teardown succeeds", async () => {
    const abortCloudLogs = vi.fn();
    const cloudLogAbortController = {
      abort: abortCloudLogs,
    } as unknown as AbortController;
    const terminateProxyWorker = vi.fn().mockResolvedValue(0);
    const proxyWorker = {
      terminate: terminateProxyWorker,
    } as unknown as NonNullable<RunningAppInfo["proxyWorker"]>;
    const appInfo: RunningAppInfo = {
      process: null,
      processId: 1,
      mode: "cloud",
      cloudSandboxId: "sandbox-1",
      lastViewedAt: Date.now(),
      cloudLogAbortController,
      proxyWorker,
    };

    runningApps.set(1, appInfo);

    await stopAppByInfo(1, appInfo);

    expect(destroyCloudSandboxMock).toHaveBeenCalledWith("sandbox-1");
    expect(stopCloudSandboxFileSyncMock).toHaveBeenCalledWith(1);
    expect(terminateProxyWorker).toHaveBeenCalled();
    expect(abortCloudLogs).toHaveBeenCalled();
    expect(unregisterRunningCloudSandboxMock).toHaveBeenCalledWith({
      appId: 1,
    });
    expect(runningApps.has(1)).toBe(false);
  });
});

describe("getRunningAppProcessPids", () => {
  beforeEach(() => {
    runningApps.clear();
  });

  it("returns only host-mode spawned process pids", () => {
    runningApps.set(1, {
      process: { pid: 111 },
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
    } as RunningAppInfo);
    runningApps.set(2, {
      process: { pid: 222 },
      processId: 2,
      mode: "docker",
      lastViewedAt: Date.now(),
    } as RunningAppInfo);
    runningApps.set(3, {
      process: null,
      processId: 3,
      mode: "cloud",
      lastViewedAt: Date.now(),
    });

    expect(getRunningAppProcessPids()).toEqual([{ appId: 1, pid: 111 }]);
  });
});

describe("stopAllAppsSync", () => {
  beforeEach(() => {
    runningApps.clear();
    vi.clearAllMocks();
  });

  it("keeps a host app tracked when synchronous termination fails", () => {
    killProcessTreeSyncMock.mockReturnValue(false);
    runningApps.set(1, {
      process: { pid: 111 },
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
    } as RunningAppInfo);

    stopAllAppsSync();

    expect(killProcessTreeSyncMock).toHaveBeenCalledWith(111);
    expect(runningApps.has(1)).toBe(true);
  });

  it("removes a host app after synchronous termination succeeds", () => {
    killProcessTreeSyncMock.mockReturnValue(true);
    runningApps.set(1, {
      process: { pid: 111 },
      processId: 1,
      mode: "host",
      lastViewedAt: Date.now(),
    } as RunningAppInfo);

    stopAllAppsSync();

    expect(runningApps.has(1)).toBe(false);
  });
});

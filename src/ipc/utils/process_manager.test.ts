import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  destroyCloudSandboxMock,
  stopCloudSandboxFileSyncMock,
  unregisterRunningCloudSandboxMock,
} = vi.hoisted(() => ({
  destroyCloudSandboxMock: vi.fn(),
  stopCloudSandboxFileSyncMock: vi.fn(),
  unregisterRunningCloudSandboxMock: vi.fn(),
}));

vi.mock("./cloud_sandbox_provider", () => ({
  destroyCloudSandbox: destroyCloudSandboxMock,
  stopCloudSandboxFileSync: stopCloudSandboxFileSyncMock,
  unregisterRunningCloudSandbox: unregisterRunningCloudSandboxMock,
}));

import {
  runningApps,
  stopAppByInfo,
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

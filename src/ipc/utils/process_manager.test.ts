import { beforeEach, describe, expect, it, vi } from "vitest";

const { killProcessTreeSyncMock } = vi.hoisted(() => ({
  killProcessTreeSyncMock: vi.fn(),
}));

vi.mock("./kill_process_tree_sync", () => ({
  killProcessTreeSync: killProcessTreeSyncMock,
}));

import {
  getRunningAppProcessPids,
  runningApps,
  stopAllAppsSync,
  type RunningAppInfo,
} from "./process_manager";

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

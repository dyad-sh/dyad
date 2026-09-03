import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  destroyCloudSandboxMock,
  stopCloudSandboxFileSyncMock,
  unregisterRunningCloudSandboxMock,
  killProcessTreeSyncMock,
  endRecordingForAppMock,
  treeKillMock,
} = vi.hoisted(() => ({
  destroyCloudSandboxMock: vi.fn(),
  stopCloudSandboxFileSyncMock: vi.fn(),
  unregisterRunningCloudSandboxMock: vi.fn(),
  killProcessTreeSyncMock: vi.fn(),
  endRecordingForAppMock: vi.fn(),
  treeKillMock: vi.fn(),
}));

// The fake processes below carry made-up PIDs. Unmocked, `killProcess` would
// signal whatever real process happens to hold that PID on the host.
vi.mock("tree-kill", () => ({
  default: (pid: number, signal: string, callback?: (err?: Error) => void) => {
    treeKillMock(pid, signal);
    callback?.(undefined);
  },
}));

vi.mock("./cloud_sandbox_provider", () => ({
  destroyCloudSandbox: destroyCloudSandboxMock,
  stopCloudSandboxFileSync: stopCloudSandboxFileSyncMock,
  unregisterRunningCloudSandbox: unregisterRunningCloudSandboxMock,
}));

vi.mock("./kill_process_tree_sync", () => ({
  killProcessTreeSync: killProcessTreeSyncMock,
}));

vi.mock("../services/recording_registry", () => ({
  endRecordingForApp: endRecordingForAppMock,
}));

import type { ChildProcess } from "node:child_process";

import {
  forceKillProcessTree,
  getRunningAppProcessPids,
  removeAppIfCurrentProcess,
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

describe("removeAppIfCurrentProcess", () => {
  beforeEach(() => {
    runningApps.clear();
    vi.clearAllMocks();
    endRecordingForAppMock.mockResolvedValue({ envRestored: true });
  });

  const hostApp = (process: ChildProcess): RunningAppInfo => ({
    process,
    processId: 1,
    mode: "host",
    lastViewedAt: Date.now(),
  });

  it("ends the recording when the dev server exits on its own", () => {
    const process = { pid: 111 } as ChildProcess;
    runningApps.set(1, hostApp(process));

    removeAppIfCurrentProcess(1, process);

    expect(runningApps.has(1)).toBe(false);
    expect(endRecordingForAppMock).toHaveBeenCalledWith(1, "app-stopped", {
      skipRestart: true,
    });
  });

  // Isolation setup restarts the app it is preparing to record. `stopAppByInfo`
  // only removes the map entry after the kill resolves, and this callback runs
  // first — so without the marker the session cancels itself during setup.
  it("leaves the recording alone for a recording-owned restart", () => {
    const process = { pid: 111 } as ChildProcess;
    const appInfo = hostApp(process);
    appInfo.recordingOwnedRestart = true;
    runningApps.set(1, appInfo);

    removeAppIfCurrentProcess(1, process);

    expect(runningApps.has(1)).toBe(false);
    expect(endRecordingForAppMock).not.toHaveBeenCalled();
  });

  it("marks the entry before the kill so the close callback can see it", async () => {
    const listeners: Array<(code: number | null) => void> = [];
    const process = {
      pid: 111,
      on: (event: string, listener: (code: number | null) => void) => {
        if (event === "close") listeners.push(listener);
      },
    } as unknown as ChildProcess;
    const appInfo = hostApp(process);
    runningApps.set(1, appInfo);

    const stopped = stopAppByInfo(1, appInfo, { recordingOwnedRestart: true });
    // Stand in for the real child's exit: the listener fires while the entry is
    // still current, which is exactly when the marker has to already be set.
    expect(runningApps.get(1)?.recordingOwnedRestart).toBe(true);
    removeAppIfCurrentProcess(1, process);
    for (const listener of listeners) listener(null);
    await stopped;

    expect(endRecordingForAppMock).not.toHaveBeenCalled();
  });

  // The marker is a one-way bit on a shared mutable object. A stop that throws
  // after latching it leaves the entry in `runningApps` still marked, and the
  // next legitimate `app-stopped` would be suppressed by a restart that is long
  // over — holding the session's claim with no preview left to record.
  it("clears the recording marker when the stop fails after latching it", async () => {
    const process = {
      pid: 111,
      on: (event: string, listener: (code: number | null) => void) => {
        if (event === "close") queueMicrotask(() => listener(null));
      },
    } as unknown as ChildProcess;
    const appInfo = hostApp(process);
    appInfo.proxyWorker = {
      terminate: vi.fn().mockRejectedValue(new Error("terminate failed")),
    } as unknown as NonNullable<RunningAppInfo["proxyWorker"]>;
    runningApps.set(1, appInfo);

    await expect(
      stopAppByInfo(1, appInfo, { recordingOwnedRestart: true }),
    ).rejects.toThrow("terminate failed");
    expect(runningApps.get(1)?.recordingOwnedRestart).toBe(false);

    removeAppIfCurrentProcess(1, process);

    expect(endRecordingForAppMock).toHaveBeenCalledWith(1, "app-stopped", {
      skipRestart: true,
    });
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

describe("forceKillProcessTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** A child whose `close`/`error` listeners the test drives by hand. */
  function fakeChild({
    pid,
    exitCode = null,
  }: {
    pid: number | undefined;
    exitCode?: number | null;
  }) {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    return {
      child: {
        pid,
        exitCode,
        signalCode: null,
        once: (event: string, listener: (...args: unknown[]) => void) => {
          listeners.set(event, listener);
        },
      } as unknown as ChildProcess,
      emit: (event: string) => listeners.get(event)?.(),
      listens: (event: string) => listeners.has(event),
    };
  }

  it("resolves true once the tree closes", async () => {
    const { child, emit } = fakeChild({ pid: 111 });
    const settled = forceKillProcessTree(child, 50);
    emit("close");

    await expect(settled).resolves.toBe(true);
    expect(treeKillMock).toHaveBeenCalledWith(111, "SIGKILL");
  });

  it("resolves false when the tree outlives the window", async () => {
    const { child } = fakeChild({ pid: 111 });

    await expect(forceKillProcessTree(child, 10)).resolves.toBe(false);
    expect(treeKillMock).toHaveBeenCalledWith(111, "SIGKILL");
  });

  it("resolves false when the child reports an error instead", async () => {
    const { child, emit } = fakeChild({ pid: 111 });
    const settled = forceKillProcessTree(child, 50);
    emit("error");

    await expect(settled).resolves.toBe(false);
  });

  it("signals but does not confirm when the root shell has already exited", async () => {
    // The E2E runtime spawns a shell, and `npm run dev` forks a server that
    // routinely outlives it. The signal still goes out — reading the root's
    // exit as "the tree is gone" would skip SIGKILL for exactly the survivor
    // holding the sandbox — but a descendant that daemonized is unreachable
    // from this pid and emits no `close`, so this cannot claim confirmation.
    // Since `killProcess` runs first, an exited root is the COMMON case; a
    // `true` here would make the caller's guard decorative.
    const { child, listens } = fakeChild({ pid: 111, exitCode: 0 });

    await expect(forceKillProcessTree(child, 50)).resolves.toBe(false);
    expect(treeKillMock).toHaveBeenCalledWith(111, "SIGKILL");
    // No `close` is coming for a root that already exited, so it must not wait
    // for one.
    expect(listens("close")).toBe(false);
  });

  it("reports failure for a child that never started", async () => {
    const { child } = fakeChild({ pid: undefined });

    await expect(forceKillProcessTree(child, 50)).resolves.toBe(false);
    expect(treeKillMock).not.toHaveBeenCalled();
  });
});

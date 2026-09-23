// @vitest-environment node

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const killProcessTreeSyncMock = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/utils/kill_process_tree_sync", () => ({
  killProcessTreeSync: killProcessTreeSyncMock,
}));

const forceKillProcessTreeMock = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/utils/process_manager", () => ({
  forceKillProcessTree: forceKillProcessTreeMock,
}));

import {
  settleE2eTestProcesses,
  stopE2eTestProcessesSync,
  trackE2eTestProcess,
  trackedE2eTestProcessCount,
  trackedE2eTestProcessesForOwner,
} from "./e2e_test_process_registry";

function fakeChild(pid: number | undefined): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  Object.assign(child, { pid, exitCode: null, signalCode: null });
  return child;
}

describe("e2e test process registry", () => {
  beforeEach(() => {
    stopE2eTestProcessesSync();
    killProcessTreeSyncMock.mockReset();
    killProcessTreeSyncMock.mockReturnValue(true);
    forceKillProcessTreeMock.mockReset();
    forceKillProcessTreeMock.mockResolvedValue(true);
  });

  describe("settleE2eTestProcesses", () => {
    it("settles only the finishing run's children", async () => {
      // The operation coordinator excludes by app, so two apps can be running
      // tests at once. A global sweep here would let either one's cleanup
      // SIGKILL the other's server and runner mid-run.
      const mine = new AbortController().signal;
      const theirs = new AbortController().signal;
      const myServer = fakeChild(11);
      const theirServer = fakeChild(22);
      trackE2eTestProcess(myServer, mine);
      trackE2eTestProcess(theirServer, theirs);

      await expect(settleE2eTestProcesses(mine)).resolves.toBe(true);

      expect(forceKillProcessTreeMock).toHaveBeenCalledTimes(1);
      expect(forceKillProcessTreeMock).toHaveBeenCalledWith(myServer);
      expect(trackedE2eTestProcessesForOwner(mine)).toEqual([]);
      expect(trackedE2eTestProcessesForOwner(theirs)).toEqual([theirServer]);
    });

    it("reports not-settled when a tree cannot be confirmed gone", async () => {
      // The caller deletes the workspace from this verdict, so an unconfirmed
      // tree has to fail closed rather than read as success.
      const owner = new AbortController().signal;
      trackE2eTestProcess(fakeChild(11), owner);
      trackE2eTestProcess(fakeChild(12), owner);
      forceKillProcessTreeMock.mockResolvedValueOnce(true);
      forceKillProcessTreeMock.mockResolvedValueOnce(false);

      await expect(settleE2eTestProcesses(owner)).resolves.toBe(false);
    });

    it("is a no-op once every child has closed", async () => {
      // The map is self-pruning, so a run whose children all closed normally
      // has nothing left to kill — and must not pay a tree-kill to find out.
      const owner = new AbortController().signal;
      const child = fakeChild(11);
      trackE2eTestProcess(child, owner);
      child.emit("exit", 0, null);
      child.emit("close", 0, null);

      await expect(settleE2eTestProcesses(owner)).resolves.toBe(true);
      expect(forceKillProcessTreeMock).not.toHaveBeenCalled();
    });

    it("keeps an exited wrapper visible to cleanup until its descendants settle", async () => {
      const controller = new AbortController();
      const child = fakeChild(11);
      trackE2eTestProcess(child, controller.signal);

      // SIGTERM stops the wrapper, but a browser/lifecycle descendant still
      // holds its pipes. spawnStreaming's forced-kill timer can then resolve
      // without emitting close, allowing the run to reach this barrier.
      controller.abort();
      Object.assign(child, { signalCode: "SIGTERM" });
      child.emit("exit", null, "SIGTERM");
      forceKillProcessTreeMock.mockResolvedValue(false);

      await expect(settleE2eTestProcesses(controller.signal)).resolves.toBe(
        false,
      );
      expect(forceKillProcessTreeMock).toHaveBeenCalledWith(child);
      expect(trackedE2eTestProcessesForOwner(controller.signal)).toEqual([
        child,
      ]);
      await expect(settleE2eTestProcesses(controller.signal)).resolves.toBe(
        false,
      );

      child.emit("close", null, "SIGTERM");
      await expect(settleE2eTestProcesses(controller.signal)).resolves.toBe(
        true,
      );
      expect(forceKillProcessTreeMock).toHaveBeenCalledTimes(2);
    });

    it("retains the tree when settlement rejects", async () => {
      const owner = new AbortController().signal;
      const child = fakeChild(11);
      trackE2eTestProcess(child, owner);
      forceKillProcessTreeMock.mockRejectedValue(new Error("kill failed"));

      await expect(settleE2eTestProcesses(owner)).resolves.toBe(false);
      expect(trackedE2eTestProcessesForOwner(owner)).toEqual([child]);
    });
  });

  it("tree-kills tracked children synchronously", () => {
    trackE2eTestProcess(fakeChild(111));
    trackE2eTestProcess(fakeChild(222));

    stopE2eTestProcessesSync();

    expect(killProcessTreeSyncMock.mock.calls.map(([pid]) => pid)).toEqual([
      111, 222,
    ]);
    expect(trackedE2eTestProcessCount()).toBe(0);
  });

  it("forgets a child once it closes", () => {
    const child = fakeChild(333);
    trackE2eTestProcess(child);
    child.emit("exit", 0, null);
    child.emit("close", 0, null);

    stopE2eTestProcessesSync();

    expect(killProcessTreeSyncMock).not.toHaveBeenCalled();
  });

  it("forgets a failed spawn but retains a process that emits an error", () => {
    const owner = new AbortController().signal;
    const failedSpawn = fakeChild(undefined);
    const running = fakeChild(11);
    trackE2eTestProcess(failedSpawn, owner);
    trackE2eTestProcess(running, owner);

    failedSpawn.emit("error", new Error("spawn failed"));
    running.emit("error", new Error("kill failed"));

    expect(trackedE2eTestProcessesForOwner(owner)).toEqual([running]);
  });

  it("skips children that already terminated or never spawned", () => {
    const exited = fakeChild(444);
    Object.assign(exited, { exitCode: 0 });
    trackE2eTestProcess(exited);
    trackE2eTestProcess(fakeChild(undefined));

    stopE2eTestProcessesSync();

    expect(killProcessTreeSyncMock).not.toHaveBeenCalled();
  });
});

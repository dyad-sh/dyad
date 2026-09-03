// @vitest-environment node

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const killProcessTreeSyncMock = vi.hoisted(() => vi.fn());
vi.mock("@/ipc/utils/kill_process_tree_sync", () => ({
  killProcessTreeSync: killProcessTreeSyncMock,
}));

import {
  stopE2eTestProcessesSync,
  trackE2eTestProcess,
  trackedE2eTestProcessCount,
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

  it("forgets a child once it exits", () => {
    const child = fakeChild(333);
    trackE2eTestProcess(child);
    child.emit("exit", 0, null);

    stopE2eTestProcessesSync();

    expect(killProcessTreeSyncMock).not.toHaveBeenCalled();
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

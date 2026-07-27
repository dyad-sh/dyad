import { describe, expect, it, vi } from "vitest";

import {
  collectDescendantPids,
  killProcessTreeSync,
} from "./kill_process_tree_sync";

describe("collectDescendantPids", () => {
  it("returns a process tree leaf-first for synchronous shutdown", () => {
    expect(
      collectDescendantPids(10, [
        { pid: 11, parentPid: 10 },
        { pid: 12, parentPid: 11 },
        { pid: 13, parentPid: 10 },
        { pid: 99, parentPid: 1 },
      ]),
    ).toEqual([12, 11, 13]);
  });
});

describe("killProcessTreeSync", () => {
  it("reports a failed Windows taskkill", () => {
    const spawnSync = vi.fn().mockReturnValue({ status: 1 });
    const kill = vi.fn();

    expect(killProcessTreeSync(42, "win32", { spawnSync, kill })).toBe(false);
    expect(spawnSync).toHaveBeenCalledWith(
      "taskkill.exe",
      ["/pid", "42", "/t", "/f"],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("reports Unix discovery or signal failures", () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
    });
    const kill = vi.fn().mockReturnValue(true);

    expect(killProcessTreeSync(42, "darwin", { spawnSync, kill })).toBe(false);
    expect(kill).toHaveBeenCalledWith(42, "SIGTERM");
  });

  it("reports a Unix signal delivery failure", () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: "42 1\n",
    });
    const kill = vi.fn().mockImplementation(() => {
      throw Object.assign(new Error("operation not permitted"), {
        code: "EPERM",
      });
    });

    expect(killProcessTreeSync(42, "linux", { spawnSync, kill })).toBe(false);
  });

  it("treats an already-exited Unix process as successfully terminated", () => {
    const spawnSync = vi.fn().mockReturnValue({
      status: 0,
      stdout: "42 1\n",
    });
    const kill = vi.fn().mockImplementation(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });

    expect(killProcessTreeSync(42, "linux", { spawnSync, kill })).toBe(true);
  });
});

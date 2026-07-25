import { describe, expect, it } from "vitest";
import { collectDescendantPids } from "./kill_process_tree_sync";

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

import { describe, expect, it } from "vitest";
import type { Version } from "@/ipc/types";
import {
  findVersionIndexForMessage,
  versionHoldsOtherTurns,
} from "./version_lookup";

function version(oid: string, extra: Partial<Version> = {}): Version {
  return {
    oid,
    message: oid,
    timestamp: 0,
    isFavorite: false,
    note: null,
    ...extra,
  };
}

describe("findVersionIndexForMessage", () => {
  const versions = [
    version("c3", { turnMessageIds: [21, 25] }),
    version("b2"),
    version("a1"),
  ];

  it("finds a main-folder turn by its own commit", () => {
    expect(
      findVersionIndexForMessage(versions, { id: 7, commitHash: "b2" }),
    ).toBe(1);
  });

  it("finds a worktree turn through the squash that names it", () => {
    // The turn's own commit stays on the worktree branch.
    expect(
      findVersionIndexForMessage(versions, {
        id: 25,
        commitHash: "worktree-commit",
      }),
    ).toBe(0);
  });

  it("tells when restoring past a version would undo other turns too", () => {
    expect(versionHoldsOtherTurns(versions[0], 25)).toBe(true);
    expect(
      versionHoldsOtherTurns(version("d4", { turnMessageIds: [25] }), 25),
    ).toBe(false);
    // Versions made in the app's folder name no turns.
    expect(versionHoldsOtherTurns(versions[1], 7)).toBe(false);
  });

  it("finds nothing for work that never reached the branch", () => {
    expect(
      findVersionIndexForMessage(versions, {
        id: 30,
        commitHash: "worktree-commit",
      }),
    ).toBe(-1);
    expect(findVersionIndexForMessage(versions, { id: 30 })).toBe(-1);
  });
});

import { describe, expect, it } from "vitest";
import type { Version } from "@/ipc/types";
import { getExtraRevertedCommits } from "./revertImpact";

const version = (oid: string): Version => ({
  oid,
  message: oid,
  timestamp: 1,
  isFavorite: false,
  note: null,
});

describe("getExtraRevertedCommits", () => {
  it("returns no extras for a normal undo", () => {
    expect(
      getExtraRevertedCommits({
        versions: [version("assistant"), version("target")],
        targetOid: "target",
        ownCommitHashes: ["assistant"],
      }),
    ).toEqual([]);
  });

  it("returns manual commits made after the assistant turn", () => {
    expect(
      getExtraRevertedCommits({
        versions: [
          version("manual-2"),
          version("manual-1"),
          version("assistant"),
          version("target"),
        ],
        targetOid: "target",
        ownCommitHashes: ["assistant"],
      }),
    ).toEqual([version("manual-2"), version("manual-1")]);
  });

  it("returns null when the target is not in the loaded log", () => {
    expect(
      getExtraRevertedCommits({
        versions: [version("head")],
        targetOid: "missing",
        ownCommitHashes: [],
      }),
    ).toBeNull();
  });

  it("returns no extras when the target is HEAD", () => {
    expect(
      getExtraRevertedCommits({
        versions: [version("head"), version("older")],
        targetOid: "head",
        ownCommitHashes: [],
      }),
    ).toEqual([]);
  });

  it("finds intermediate commits between assistant turns during retry", () => {
    expect(
      getExtraRevertedCommits({
        versions: [
          version("latest-assistant"),
          version("checkpoint"),
          version("previous-assistant"),
        ],
        targetOid: "previous-assistant",
        ownCommitHashes: ["latest-assistant"],
      }),
    ).toEqual([version("checkpoint")]);
  });
});

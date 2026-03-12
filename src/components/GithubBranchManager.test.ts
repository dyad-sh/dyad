import { describe, expect, it } from "vitest";
import { buildBranchListItems } from "@/components/GithubBranchManager";

describe("buildBranchListItems", () => {
  it("marks local and remote-only branches distinctly", () => {
    expect(
      buildBranchListItems(
        ["main", "feature-local", "shared"],
        ["shared", "staging"],
      ),
    ).toEqual([
      { name: "feature-local", isLocal: true, isRemote: false },
      { name: "main", isLocal: true, isRemote: false },
      { name: "shared", isLocal: true, isRemote: true },
      { name: "staging", isLocal: false, isRemote: true },
    ]);
  });
});

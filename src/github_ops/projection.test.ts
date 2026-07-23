import { describe, expect, it } from "vitest";
import { INITIAL_GITHUB_OPS_STATE } from "./state";
import { projectGithubOps } from "./projection";

describe("projectGithubOps", () => {
  it("is reference-stable for the same immutable snapshot", () => {
    expect(projectGithubOps(INITIAL_GITHUB_OPS_STATE)).toBe(
      projectGithubOps(INITIAL_GITHUB_OPS_STATE),
    );
  });

  it("derives coded recovery controls without parsing messages", () => {
    const projection = projectGithubOps({
      type: "idle",
      banner: {
        kind: "error",
        code: "DIVERGENT_BRANCHES",
        message: "localized text can change",
      },
    });

    expect(projection.showRebaseAndSync).toBe(true);
    expect(projection.showForcePush).toBe(false);
  });

  it.each(["rebase", "rebase-continue", "rebase-abort"] as const)(
    "uses rebase recovery for %s conflict provenance",
    (type) => {
      const projection = projectGithubOps({
        type: "conflicted",
        files: ["src/conflicted.ts"],
        origin: { type },
        banner: null,
      });

      expect(projection.rebaseInProgress).toBe(true);
      expect(projection.abortOperation).toBe("rebase-abort");
    },
  );

  it("disables primary sync outside idle", () => {
    expect(projectGithubOps(INITIAL_GITHUB_OPS_STATE).canRequestSync).toBe(
      true,
    );
    expect(
      projectGithubOps({
        type: "conflicted",
        files: ["src/conflicted.ts"],
        origin: { type: "reconcile" },
        banner: null,
      }).canRequestSync,
    ).toBe(false);
    expect(
      projectGithubOps({ type: "rebase-paused", banner: null }).canRequestSync,
    ).toBe(false);
  });

  it("separates recovery switching from idle-only branch mutations", () => {
    const conflicted = projectGithubOps({
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "merge", branch: "feature" },
      banner: null,
    });
    const rebasePaused = projectGithubOps({
      type: "rebase-paused",
      banner: null,
    });

    expect(conflicted.canRequestBranchSwitch).toBe(true);
    expect(rebasePaused.canRequestBranchSwitch).toBe(true);
    expect(conflicted.canRequestBranchMutation).toBe(false);
    expect(rebasePaused.canRequestBranchMutation).toBe(false);
  });
});

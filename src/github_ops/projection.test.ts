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

  it("projects typed successful operation completion", () => {
    expect(
      projectGithubOps({
        type: "idle",
        banner: {
          kind: "success",
          completedOperation: "rename-branch",
          message: "Renamed branch",
        },
      }).completedOperation,
    ).toBe("rename-branch");
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
    expect(
      projectGithubOps(INITIAL_GITHUB_OPS_STATE).capabilities.canSync,
    ).toBe(true);
    expect(
      projectGithubOps({
        type: "conflicted",
        files: ["src/conflicted.ts"],
        origin: { type: "reconcile" },
        banner: null,
      }).capabilities.canSync,
    ).toBe(false);
    expect(
      projectGithubOps({ type: "rebase-paused", banner: null }).capabilities
        .canSync,
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

    expect(conflicted.capabilities.canSwitchBranches).toBe(true);
    expect(rebasePaused.capabilities.canSwitchBranches).toBe(true);
    expect(conflicted.capabilities.canMutateBranches).toBe(false);
    expect(rebasePaused.capabilities.canMutateBranches).toBe(false);
  });

  it("disables disconnect while conflict or rebase recovery owns Git", () => {
    const conflicted = projectGithubOps({
      type: "conflicted",
      files: ["src/conflicted.ts"],
      origin: { type: "reconcile" },
      banner: null,
    });
    const rebasePaused = projectGithubOps({
      type: "rebase-paused",
      banner: null,
    });

    expect(conflicted.capabilities.canDisconnect).toBe(false);
    expect(rebasePaused.capabilities.canDisconnect).toBe(false);
  });
});

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
});

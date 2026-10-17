import { describe, expect, it } from "vitest";
import {
  classifyPushOutcome,
  describePushSummary,
  summarizePush,
  type PushFacts,
} from "./push_summary";

const head = "ffb146379f79dd759b23f63feba9f90ec9c6ff27";
const older = "c872cc36c4c5c1feb2d046d9d20d4f68c4598283";

const base: PushFacts = {
  pushedBranch: "main",
  currentBranch: "main",
  branchKnown: true,
  head,
  remoteTip: head,
  remoteMoved: true,
  commitsPushed: 2,
  files: { added: 1, modified: 1, deleted: 0, renamed: 0 },
  uncommittedFiles: 0,
  commitsNotOnRemote: 0,
};

describe("classifyPushOutcome", () => {
  it("is pushed when the remote moved to the user's commit", () => {
    expect(classifyPushOutcome(base)).toBe("pushed");
  });

  it("is up to date when the remote already held the user's commit", () => {
    expect(
      classifyPushOutcome({ ...base, remoteMoved: false, commitsPushed: 0 }),
    ).toBe("up-to-date");
  });

  it("prefers uncommitted work over up to date", () => {
    expect(
      classifyPushOutcome({
        ...base,
        remoteMoved: false,
        commitsPushed: 0,
        uncommittedFiles: 3,
      }),
    ).toBe("uncommitted-changes");
  });

  it("is wrong-branch when HEAD is on a branch other than the pushed one", () => {
    expect(
      classifyPushOutcome({
        ...base,
        pushedBranch: "other2",
        remoteTip: older,
        remoteMoved: false,
        commitsPushed: 0,
        commitsNotOnRemote: 5,
      }),
    ).toBe("wrong-branch");
  });

  it("is detached-head when HEAD is on no branch", () => {
    expect(
      classifyPushOutcome({
        ...base,
        currentBranch: null,
        remoteTip: older,
        remoteMoved: false,
        commitsPushed: 0,
        commitsNotOnRemote: 2,
      }),
    ).toBe("detached-head");
  });

  it("is unverified when the branches agree but the commits do not", () => {
    expect(
      classifyPushOutcome({
        ...base,
        remoteTip: older,
        remoteMoved: false,
        commitsPushed: 0,
        commitsNotOnRemote: 1,
      }),
    ).toBe("unverified");
  });

  it("is unverified rather than pushed when the remote tip cannot be read", () => {
    expect(
      classifyPushOutcome({
        ...base,
        remoteTip: null,
        remoteMoved: false,
        commitsPushed: null,
        files: null,
      }),
    ).toBe("unverified");
  });

  it("is up to date when HEAD is behind the remote tip on the same branch", () => {
    const behind = {
      ...base,
      head: older,
      remoteMoved: false,
      commitsPushed: 0,
      commitsNotOnRemote: 0,
    };
    expect(classifyPushOutcome(behind)).toBe("up-to-date");
    expect(classifyPushOutcome({ ...behind, uncommittedFiles: 1 })).toBe(
      "uncommitted-changes",
    );
  });

  it("still reports a branch mismatch when nothing is missing yet", () => {
    expect(
      classifyPushOutcome({
        ...base,
        pushedBranch: "feature",
        head: older,
        remoteMoved: false,
        commitsPushed: 0,
        commitsNotOnRemote: 0,
      }),
    ).toBe("wrong-branch");
  });

  it("still reports the branch problem when something else was pushed", () => {
    // The stored branch had its own new commit, so the remote moved, but
    // the user's work is on another branch and did not go anywhere.
    expect(
      classifyPushOutcome({
        ...base,
        pushedBranch: "other2",
        remoteTip: older,
        remoteMoved: true,
        commitsPushed: 1,
        commitsNotOnRemote: 5,
      }),
    ).toBe("wrong-branch");
  });
});

describe("summarizePush", () => {
  it("abbreviates commits for the wire and keeps the counts", () => {
    expect(summarizePush(base)).toEqual({
      outcome: "pushed",
      pushedBranch: "main",
      currentBranch: "main",
      commitsPushed: 2,
      files: { added: 1, modified: 1, deleted: 0, renamed: 0 },
      uncommittedFiles: 0,
      commitsNotOnRemote: 0,
      head: "ffb1463",
      remoteTip: "ffb1463",
    });
  });
});

describe("describePushSummary", () => {
  it("uses singular wording for one commit and one file", () => {
    expect(
      describePushSummary(
        summarizePush({
          ...base,
          commitsPushed: 1,
          files: { added: 1, modified: 0, deleted: 0, renamed: 0 },
        }),
        "GitHub",
      ),
    ).toEqual({
      kind: "success",
      message: "Successfully pushed to GitHub!",
      detail: "1 commit on main: 1 file added.",
    });
  });

  it("omits the file list when nothing is countable", () => {
    expect(
      describePushSummary(
        summarizePush({ ...base, commitsPushed: 4, files: null }),
        "GitLab",
      ),
    ).toEqual({
      kind: "success",
      message: "Successfully pushed to GitLab!",
      detail: "4 commits on main.",
    });
  });

  it("keeps the headline alone when the push could not be counted", () => {
    expect(
      describePushSummary(
        summarizePush({ ...base, commitsPushed: null, files: null }),
        "GitHub",
      ),
    ).toEqual({ kind: "success", message: "Successfully pushed to GitHub!" });
  });

  it("names both commits when the branches agree but the tips do not", () => {
    expect(
      describePushSummary(
        {
          ...summarizePush(base),
          outcome: "unverified",
          remoteTip: "c872cc3",
        },
        "GitHub",
      ),
    ).toEqual({
      kind: "warning",
      message: "Sync finished, but your latest commit is not on GitHub.",
      detail: "Your main is at ffb1463; GitHub's main is at c872cc3.",
    });
  });
});

describe("describePushSummary edge wording", () => {
  const wrongBranch = {
    ...summarizePush(base),
    outcome: "wrong-branch" as const,
    pushedBranch: "feature",
    currentBranch: "main",
    commitsPushed: 0,
    commitsNotOnRemote: 0,
  };

  it("keeps the mismatch warning but says nothing is missing yet", () => {
    expect(describePushSummary(wrongBranch, "GitHub")).toEqual({
      kind: "warning",
      message: "You're working on main, but Dyad syncs feature.",
      detail:
        "feature was already up to date. Everything on main is already on GitHub's feature, but new commits on main won't be synced.",
    });
  });

  it("leaves out what it could not count", () => {
    expect(
      describePushSummary(
        { ...wrongBranch, commitsPushed: null, commitsNotOnRemote: 2 },
        "GitHub",
      ).detail,
    ).toBe("2 commits on main are not on GitHub's feature.");
  });

  it("softens the detached headline when nothing is missing", () => {
    expect(
      describePushSummary(
        {
          ...wrongBranch,
          outcome: "detached-head",
          currentBranch: null,
          pushedBranch: "main",
        },
        "GitHub",
      ),
    ).toEqual({
      kind: "warning",
      message: "You're not on a branch, so new commits won't be synced.",
      detail: "main was already up to date.",
    });
  });

  it("never shows a zero count under the success headline", () => {
    expect(
      describePushSummary(
        { ...summarizePush(base), outcome: "pushed", commitsPushed: 0 },
        "GitHub",
      ),
    ).toEqual({ kind: "success", message: "Successfully pushed to GitHub!" });
  });

  it("admits when the push could not be confirmed", () => {
    expect(
      describePushSummary(
        summarizePush({
          ...base,
          remoteTip: null,
          remoteMoved: false,
          commitsPushed: null,
          files: null,
        }),
        "GitLab",
      ),
    ).toEqual({
      kind: "warning",
      message: "Dyad couldn't confirm the push.",
      detail:
        "Git reported success, but GitLab's main couldn't be read afterwards.",
    });
  });
});

describe("classifyPushOutcome with matching tips", () => {
  const sameCommit = {
    ...base,
    remoteMoved: false,
    commitsPushed: 0,
    commitsNotOnRemote: 0,
  };

  it("reports a branch mismatch even when HEAD is the remote tip", () => {
    // Right after creating a branch and switching back, both branches point
    // at the same commit; the next commit on the current branch is still
    // the one that would not be synced.
    expect(
      classifyPushOutcome({ ...sameCommit, pushedBranch: "feature" }),
    ).toBe("wrong-branch");
  });

  it("reports a detached HEAD even when it is the remote tip", () => {
    expect(classifyPushOutcome({ ...sameCommit, currentBranch: null })).toBe(
      "detached-head",
    );
  });
});

describe("classifyPushOutcome with an unreadable branch", () => {
  const unknownBranch = { ...base, currentBranch: null, branchKnown: false };

  it("is not mistaken for a detached HEAD", () => {
    expect(
      classifyPushOutcome({
        ...unknownBranch,
        head: older,
        remoteMoved: false,
        commitsPushed: 0,
        commitsNotOnRemote: 1,
      }),
    ).toBe("unverified");
  });

  it("still trusts a remote tip that matches HEAD", () => {
    expect(classifyPushOutcome(unknownBranch)).toBe("pushed");
  });

  it("admits it could not read the current commit", () => {
    expect(
      describePushSummary(
        summarizePush({
          ...unknownBranch,
          head: "",
          remoteMoved: false,
          commitsPushed: 0,
        }),
        "GitHub",
      ),
    ).toEqual({
      kind: "warning",
      message: "Dyad couldn't confirm the push.",
      detail:
        "Git reported success, but your current commit couldn't be read afterwards.",
    });
  });
});

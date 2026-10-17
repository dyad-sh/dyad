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

  it("trusts the exit code when the remote tip cannot be read", () => {
    expect(
      classifyPushOutcome({
        ...base,
        remoteTip: null,
        remoteMoved: false,
        commitsPushed: null,
        files: null,
      }),
    ).toBe("pushed");
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
        summarizePush({
          ...base,
          remoteTip: null,
          remoteMoved: false,
          commitsPushed: null,
          files: null,
        }),
        "GitHub",
      ),
    ).toEqual({ kind: "success", message: "Successfully pushed to GitHub!" });
  });

  it("says the remote tip is unknown when it could not be read", () => {
    expect(
      describePushSummary(
        {
          ...summarizePush(base),
          outcome: "unverified",
          remoteTip: null,
        },
        "GitHub",
      ),
    ).toEqual({
      kind: "warning",
      message: "Sync finished, but your latest commit is not on GitHub.",
      detail: "Your main is at ffb1463; GitHub's main is at an unknown commit.",
    });
  });
});

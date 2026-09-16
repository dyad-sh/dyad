import { describe, expect, it, vi } from "vitest";

vi.mock("@/main/settings", () => ({ readSettings: () => ({}) }));

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { githubRemote, gitlabRemote } from "./app_git_remote";
import { isProtectedBranchRejection, withPushHint } from "./git_push_hints";

const gitlab = gitlabRemote({
  host: "https://gitlab.example.com",
  projectId: 9,
  projectPath: "team/demo",
  branch: "main",
});

describe("withPushHint", () => {
  it("explains a GitLab protected-branch rejection and keeps the code", () => {
    const original = Object.assign(
      new DyadError(
        "Git push failed: remote: GitLab: You are not allowed to force push code to a protected branch on this project.",
        DyadErrorKind.Conflict,
      ),
      { code: "NON_FAST_FORWARD" },
    );

    const hinted = withPushHint(original, gitlab) as DyadError & {
      code?: string;
    };

    expect(hinted).not.toBe(original);
    expect(hinted.message).toContain("not allowed to force push");
    expect(hinted.message).toContain('protects the "main" branch');
    expect(hinted.message).toContain("Protected branches");
    expect(hinted.kind).toBe(DyadErrorKind.Conflict);
    expect(hinted.code).toBe("NON_FAST_FORWARD");
  });

  it("leaves other GitLab errors alone", () => {
    const error = new Error("Git push failed: could not resolve host");
    expect(withPushHint(error, gitlab)).toBe(error);
  });

  it("never touches GitHub errors", () => {
    const error = new Error("remote: pre-receive hook declined");
    expect(withPushHint(error, githubRemote({ owner: "o", repo: "r" }))).toBe(
      error,
    );
  });
});

describe("isProtectedBranchRejection", () => {
  it("recognises the messages GitLab sends", () => {
    expect(
      isProtectedBranchRejection(
        "GitLab: You are not allowed to push code to protected branches on this project.",
      ),
    ).toBe(true);
    expect(
      isProtectedBranchRejection(
        "! [remote rejected] main -> main (pre-receive hook declined)",
      ),
    ).toBe(true);
    expect(isProtectedBranchRejection("Authentication failed")).toBe(false);
  });
});

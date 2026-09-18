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

    const hinted = withPushHint(original, gitlab, {
      forced: true,
    }) as DyadError & {
      code?: string;
    };

    expect(hinted).not.toBe(original);
    expect(hinted.message).toContain("not allowed to force push");
    expect(hinted.message).toContain('protects the "main" branch');
    expect(hinted.message).toContain("Protected branches");
    expect(hinted.message).toContain('allow force push for "main"');
    expect(hinted.kind).toBe(DyadErrorKind.Conflict);
    expect(hinted.code).toBe("NON_FAST_FORWARD");
  });

  it("asks for push permission, not force push, when nothing was forced", () => {
    // Allowing force push does not grant permission to push at all, so the
    // remedy has to follow the operation that was actually rejected.
    const original = new DyadError(
      "GitLab: You are not allowed to push code to protected branches on this project.",
      DyadErrorKind.Conflict,
    );

    const hinted = withPushHint(original, gitlab) as DyadError;

    expect(hinted.message).toContain('allow your role to push to "main"');
    expect(hinted.message).not.toContain("allow force push");
  });

  it("leaves a push rule that is not branch protection alone", () => {
    // GitLab raises the same pre-receive suffix for commit-message formats,
    // file-size limits and committer-email rules. Pointing those at Protected
    // branches names a setting that has nothing to do with the rejection.
    const error = new DyadError(
      "! [remote rejected] main -> main (pre-receive hook declined)\n" +
        "remote: GitLab: Commit message does not follow the pattern",
      DyadErrorKind.Conflict,
    );

    expect(withPushHint(error, gitlab)).toBe(error);
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
        "GitLab: You are not allowed to force push code to a protected branch on this project.",
      ),
    ).toBe(true);
    expect(isProtectedBranchRejection("Authentication failed")).toBe(false);
    // A bare pre-receive rejection says nothing about branch protection.
    expect(
      isProtectedBranchRejection(
        "! [remote rejected] main -> main (pre-receive hook declined)",
      ),
    ).toBe(false);
  });
});

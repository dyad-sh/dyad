import { describe, expect, it } from "vitest";
import { safeGithubOpsErrorMessage } from "./github_ops_safe_error";

describe("safeGithubOpsErrorMessage", () => {
  it("preserves a bounded presentation-safe message", () => {
    expect(
      safeGithubOpsErrorMessage(
        new Error("The remote branch does not exist"),
        "GitHub operation failed",
      ),
    ).toBe("The remote branch does not exist");
  });

  it.each([
    "fatal: could not read from https://github.com/acme/private.git",
    "fatal: could not read from git@github.com:acme/private.git",
    "fatal: Unable to create '/Users/alice/apps/demo/.git/index.lock'",
    String.raw`fatal: C:\Users\alice\apps\demo\.git\index.lock exists`,
    "authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz",
  ])("replaces unsafe main-process details: %s", (message) => {
    expect(
      safeGithubOpsErrorMessage(new Error(message), "GitHub operation failed"),
    ).toBe("GitHub operation failed");
  });
});

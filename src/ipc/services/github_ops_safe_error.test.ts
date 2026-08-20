import { describe, expect, it } from "vitest";
import { MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH } from "@/github_ops/error_message";
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

  it("preserves actionable multiline GitHub output while redacting URLs", () => {
    const message = [
      "Git push failed: remote: error: Trace: 983f3c92",
      "remote: error: See https://gh.io/lfs for more information.",
      "remote: error: File node_modules/@next/swc-darwin-arm64/next-swc.darwin-arm64.node is 124.08 MB; this exceeds GitHub's file size limit of 100.00 MB",
      "remote: error: GH001: Large files detected. You may want to try Git Large File Storage - https://git-lfs.github.com.",
    ].join("\r\n");

    expect(
      safeGithubOpsErrorMessage(new Error(message), "GitHub operation failed"),
    ).toBe(
      [
        "Git push failed: remote: error: Trace: 983f3c92",
        "remote: error: See [redacted URL] for more information.",
        "remote: error: File node_modules/@next/swc-darwin-arm64/next-swc.darwin-arm64.node is 124.08 MB; this exceeds GitHub's file size limit of 100.00 MB",
        "remote: error: GH001: Large files detected. You may want to try Git Large File Storage - [redacted URL].",
      ].join("\n"),
    );
  });

  it.each([
    [
      "fatal: could not read from https://github.com/acme/private.git",
      "fatal: could not read from [redacted URL]",
    ],
    [
      "fatal: could not read from git@github.com:acme/private.git",
      "fatal: could not read from [redacted remote]",
    ],
    [
      "fatal: Unable to create '/Users/alice/apps/demo/.git/index.lock'",
      "fatal: Unable to create '[redacted path]'",
    ],
    [
      String.raw`fatal: C:\Users\alice\apps\demo\.git\index.lock exists`,
      "fatal: [redacted path] exists",
    ],
    [
      "authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz",
      "[redacted credential]",
    ],
    ["Authorization: Basic dXNlcjpwYXNz", "[redacted credential]"],
    ["Private-Token=Custom abc secret", "[redacted credential]"],
    [
      "fatal: Unable to create '/Users/alice/My Projects/secret/.git/index.lock'",
      "fatal: Unable to create '[redacted path]'",
    ],
    [
      String.raw`fatal: "C:\Users\alice\My Projects\secret\.git\index.lock" exists`,
      'fatal: "[redacted path]" exists',
    ],
  ])("redacts unsafe main-process details: %s", (message, expected) => {
    expect(
      safeGithubOpsErrorMessage(new Error(message), "GitHub operation failed"),
    ).toBe(expected);
  });

  it("falls back for values without an Error message", () => {
    expect(
      safeGithubOpsErrorMessage("push failed", "GitHub operation failed"),
    ).toBe("GitHub operation failed");
  });

  it("bounds unusually large Git output with a visible notice", () => {
    const result = safeGithubOpsErrorMessage(
      new Error("x".repeat(MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH + 100)),
      "GitHub operation failed",
    );

    expect(result).toHaveLength(MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH);
    expect(result).toMatch(/\n… \[GitHub error output truncated\]$/);
  });
});

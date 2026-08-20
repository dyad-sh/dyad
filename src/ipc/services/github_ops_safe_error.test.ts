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
        "remote: error: See https://gh.io/lfs for more information.",
        "remote: error: File node_modules/@next/swc-darwin-arm64/next-swc.darwin-arm64.node is 124.08 MB; this exceeds GitHub's file size limit of 100.00 MB",
        "remote: error: GH001: Large files detected. You may want to try Git Large File Storage - https://git-lfs.github.com.",
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
      "fatal: Unable to create '/Users/alice/Alice's App/secret/.git/index.lock'",
      "fatal: Unable to create '[redacted path]'",
    ],
    [
      "remote: error: File '/tmp/build/a.bin' is 124 MB; see 'https://gh.io/lfs'",
      "remote: error: File '[redacted path]' is 124 MB; see 'https://gh.io/lfs'",
    ],
    [
      String.raw`fatal: "C:\Users\alice\My Projects\secret\.git\index.lock" exists`,
      'fatal: "[redacted path]" exists',
    ],
    [
      "fatal: --git-dir=/Users/alice/apps/demo/.git is unavailable",
      "fatal: --git-dir=[redacted path] is unavailable",
    ],
    [
      "fatal: repository [/Users/alice/apps/demo/.git] is unavailable",
      "fatal: repository [[redacted path]] is unavailable",
    ],
    [
      String.raw`fatal: "\\server\Secret Share\demo.git" is unavailable`,
      'fatal: "[redacted path]" is unavailable',
    ],
    [
      "Permission to acme/private.git denied while contacting proxy.corp.internal",
      "Permission to [redacted remote] denied while contacting [redacted host]",
    ],
    ["trace: deploy@code.example.com:team/private", "trace: [redacted remote]"],
    ["hook: src/App.tsx:42:7 failed", "hook: src/App.tsx:42:7 failed"],
    [
      "hook: src/main.ts:10:5: error TS1005",
      "hook: src/main.ts:10:5: error TS1005",
    ],
    [
      "changed .env.local and vite.config.local",
      "changed .env.local and vite.config.local",
    ],
    [
      "remote: Permission to org/repo.git denied to alice.",
      "remote: Permission to [redacted remote] denied to [redacted identity].",
    ],
    [
      "fatal: unable to auto-detect email address (got 'alice@Alices-MacBook-Pro.local')",
      "fatal: unable to auto-detect email address (got '[redacted identity]')",
    ],
    [
      "fatal: unable to create /Users/John Smith/dyad-apps/demo/.git/index.lock",
      "fatal: unable to create [redacted path]",
    ],
    [
      String.raw`fatal: unable to create C:\Users\John Smith\dyad-apps\demo\.git\index.lock`,
      "fatal: unable to create [redacted path]",
    ],
    [
      "fatal: cannot access /Users/alice/Secret Project/customer.txt",
      "fatal: cannot access [redacted path]",
    ],
    [
      String.raw`fatal: unable to read C:\Users\John Smith\dyad-apps\demo\src\App.tsx`,
      "fatal: unable to read [redacted path]",
    ],
    [
      "fatal: unable to auto-detect email address (got 'root@hostname.(none)')",
      "fatal: unable to auto-detect email address (got '[redacted identity]')",
    ],
    [
      "fatal: unable to auto-detect email address (got 'alice@localhost')",
      "fatal: unable to auto-detect email address (got '[redacted identity]')",
    ],
    [
      "fatal: repository 'file:///Users/alice/dyad-apps/demo' does not exist",
      "fatal: repository '[redacted URL]' does not exist",
    ],
    [
      "hook: OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
      "hook: OPENAI_API_KEY=[redacted secret]",
    ],
    [
      "hook: token eyJabcdefghijklmnopqrstuvwxyz.abcdefghi.abcdefghij",
      "hook: token [redacted secret]",
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

    expect(result).toContain("… [line truncated]");
    expect(result.length).toBeLessThan(MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH);
  });

  it("pre-bounds raw output before running redaction", () => {
    const result = safeGithubOpsErrorMessage(
      new Error("x".repeat(MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH * 100)),
      "GitHub operation failed",
    );

    expect(result).toContain("… [line truncated]");
    expect(result.length).toBeLessThan(MAX_GITHUB_OPS_ERROR_MESSAGE_LENGTH);
  });

  it("bounds individual lines before running redaction", () => {
    const result = safeGithubOpsErrorMessage(
      new Error(`hook: ${" /a".repeat(20_000)}`),
      "GitHub operation failed",
    );

    expect(result).toContain("… [line truncated]");
    expect(result.length).toBeLessThan(5000);
  });
});

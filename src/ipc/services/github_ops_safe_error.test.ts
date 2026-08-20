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
      "GitHub operation failed",
    ],
    ["hook: Bearer opaqueHookSecret123", "hook: Bearer [redacted secret]"],
    ["hook: glpat-abcdefghijklmnop", "hook: [redacted token]"],
    ["hook: xoxb-1234567890-secret", "hook: [redacted token]"],
    ["hook: AKIAABCDEFGHIJKLMNOP", "hook: [redacted token]"],
    ["hook: sk-ant-abcdefghijklmnop", "hook: [redacted token]"],
    ["Authorization: Basic dXNlcjpwYXNz", "GitHub operation failed"],
    ["Private-Token=Custom abc secret", "GitHub operation failed"],
    [
      "fatal: Unable to create '/Users/alice/My Projects/secret/.git/index.lock'",
      "fatal: Unable to create '[redacted path]'",
    ],
    [
      "fatal: Unable to create '/Users/alice/Alice's App/secret/.git/index.lock'",
      "fatal: Unable to create '[redacted path]'",
    ],
    [
      "fatal: Unable to create '/tmp/Clients' Work/.git/index.lock'",
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
    ["trace: buildbox:team/private", "trace: [redacted remote]"],
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
      "fatal: unable to create [redacted path] … [path remainder redacted]",
    ],
    [
      String.raw`fatal: unable to create C:\Users\John Smith\dyad-apps\demo\.git\index.lock`,
      "fatal: unable to create [redacted path] … [path remainder redacted]",
    ],
    [
      "fatal: cannot access /Users/alice/Secret Project/customer.txt",
      "fatal: cannot access [redacted path] … [path remainder redacted]",
    ],
    [
      String.raw`fatal: unable to read C:\Users\John Smith\dyad-apps\demo\src\App.tsx`,
      "fatal: unable to read [redacted path] … [path remainder redacted]",
    ],
    [
      "fatal: cannot access /Volumes/Client Work/customer.txt",
      "fatal: cannot access [redacted path] … [path remainder redacted]",
    ],
    [
      "fatal: cannot open /Users/alice/app/.git/index.lock: Permission denied",
      "fatal: cannot open [redacted path]: Permission denied",
    ],
    [
      "hook: /Users/alice/app/src/App.tsx:42:7: type error",
      "hook: [redacted path]:42:7: type error",
    ],
    [
      "hook: /Users/alice/app/scripts/build.sh exited with code 1",
      "hook: [redacted path] exited with code 1",
    ],
    [
      "error: symlink /Users/alice/app/link (No such file or directory)",
      "error: symlink [redacted path] (No such file or directory)",
    ],
    [
      "error: cannot stat /srv/data/out.bin during sync",
      "error: cannot stat [redacted path] during sync",
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
    [
      "hook: api_key=ordinary-lowercase-secret",
      "hook: api_key=[redacted secret]",
    ],
    ['hook: token: "abc123"', "hook: token: [redacted secret]"],
    [
      "fatal: Could not resolve host: gitlab.local",
      "fatal: Could not resolve host: [redacted host]",
    ],
    [
      "ssh: connect to host 10.0.0.5 port 22: Connection refused",
      "ssh: connect to host [redacted host] port 22: Connection refused",
    ],
    [
      "ssh: connect to host [fd00::1234] port 22: Connection refused",
      "ssh: connect to host [redacted host] port 22: Connection refused",
    ],
    [
      "curl: Failed to connect to 10.0.0.5 port 443: Connection refused",
      "curl: Failed to connect to [redacted host] port 443: Connection refused",
    ],
    [
      "ssh: Could not resolve hostname buildbox: Name or service not known",
      "ssh: Could not resolve hostname [redacted host]: Name or service not known",
    ],
    [
      "hook: GIT_ASKPASS=/Users/alice/bin/askpass",
      "hook: GIT_ASKPASS=[redacted path]",
    ],
    [
      "hook: https://docs.github.com/ghp_abcdefghijklmnopqrstuvwxyz",
      "hook: [redacted URL]",
    ],
    [
      "hook: DYAD_PUBLIC_GIT_DOCUMENTATION_URL_7",
      "hook: DYAD_PUBLIC_GIT_DOCUMENTATION_URL_7",
    ],
    [
      "hook: -----BEGIN OPENSSH PRIVATE KEY-----\nsecretpayload\n-----END OPENSSH PRIVATE KEY-----",
      "hook: [redacted private key]",
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

  it("falls back when a high-confidence sensitive path survives redaction", () => {
    expect(
      safeGithubOpsErrorMessage(
        new Error("hook#x/Users/alice/private-project"),
        "GitHub operation failed",
      ),
    ).toBe("GitHub operation failed");
  });

  it.each([
    "hook#x/srv/clients/acme/build.log",
    String.raw`error:D:\Projects\acme-client\.git\index.lock`,
    "hook: ~/Clients/acme/config",
    "hook: -----BEGIN PRIVATE KEY-----\nincomplete",
  ])("falls back for a residual sensitive form: %s", (message) => {
    expect(
      safeGithubOpsErrorMessage(new Error(message), "GitHub operation failed"),
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

  it("handles a long dotted line without mistaking it for an SCP remote", () => {
    const message = `hook: ${"segment.".repeat(500)}`;
    expect(
      safeGithubOpsErrorMessage(new Error(message), "GitHub operation failed"),
    ).toBe(message);
  });
});

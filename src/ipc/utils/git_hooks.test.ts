import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));
vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ enableNativeGit: true })),
}));
vi.mock("../handlers/github_handlers", () => ({
  getGithubUser: vi.fn().mockResolvedValue(null),
}));

import { gitAdd, gitAddAll, gitCommit, gitRemove } from "./git_utils";

describe("scoped native Git hook suppression", () => {
  let appPath: string;
  let markerPath: string;

  function runGit(...args: string[]): void {
    execFileSync("git", args, { cwd: appPath, stdio: "pipe" });
  }

  function installHook(name: string): void {
    const hookPath = path.join(appPath, ".git", "hooks", name);
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh\nprintf '%s\\n' '${name}' >> .hook-marker\n`,
    );
    fs.chmodSync(hookPath, 0o755);
  }

  beforeEach(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-hook-test-"));
    markerPath = path.join(appPath, ".hook-marker");
    runGit("init", "-q");
    fs.writeFileSync(path.join(appPath, "initial.txt"), "initial");
    runGit("add", "initial.txt");
    runGit(
      "-c",
      "user.name=Test User",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "initial",
    );
    for (const hookName of [
      "post-index-change",
      "pre-commit",
      "prepare-commit-msg",
      "post-commit",
    ]) {
      installHook(hookName);
    }
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  it("suppresses hooks for automated add/remove/commit without disabling explicit Git operations", async () => {
    fs.writeFileSync(path.join(appPath, "stage-all.txt"), "agent");
    await gitAddAll({ path: appPath, disableHooks: true });
    expect(fs.existsSync(markerPath)).toBe(false);
    await gitCommit({
      path: appPath,
      message: "automated stage all",
      disableHooks: true,
    });
    expect(fs.existsSync(markerPath)).toBe(false);

    fs.writeFileSync(path.join(appPath, "stage-one.txt"), "agent");
    await gitAdd({
      path: appPath,
      filepath: "stage-one.txt",
      disableHooks: true,
    });
    expect(fs.existsSync(markerPath)).toBe(false);
    await gitCommit({
      path: appPath,
      message: "automated stage one",
      disableHooks: true,
    });
    expect(fs.existsSync(markerPath)).toBe(false);

    fs.unlinkSync(path.join(appPath, "stage-one.txt"));
    await gitRemove({
      path: appPath,
      filepath: "stage-one.txt",
      disableHooks: true,
    });
    expect(fs.existsSync(markerPath)).toBe(false);
    await gitCommit({
      path: appPath,
      message: "automated remove",
      disableHooks: true,
    });
    expect(fs.existsSync(markerPath)).toBe(false);

    fs.writeFileSync(path.join(appPath, "explicit.txt"), "user");
    await gitAdd({ path: appPath, filepath: "explicit.txt" });
    expect(fs.readFileSync(markerPath, "utf8")).toContain("post-index-change");

    fs.rmSync(markerPath);
    await gitCommit({ path: appPath, message: "explicit commit" });
    const explicitHooks = fs.readFileSync(markerPath, "utf8");
    expect(explicitHooks).toContain("pre-commit");
    expect(explicitHooks).toContain("prepare-commit-msg");
    expect(explicitHooks).toContain("post-commit");
  });
});

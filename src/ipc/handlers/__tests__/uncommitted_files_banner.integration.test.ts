// @vitest-environment node
//
// Migrated from e2e-tests/uncommitted_files_banner.spec.ts.
//
// The banner/dialog UI (banner visibility, toast, dialog open/close, default
// commit-message input value, "Added"/"Modified" labels) is renderer-only and
// is dropped. The behavior it fronts is the git IPC surface the banner uses:
//   - `git:get-uncommitted-files` (banner visibility + changed-files list,
//     with added/modified statuses)
//   - `git:commit-changes` (Review & commit -> commit with a custom message)
//   - `git:discard-changes` (Discard all -> untracked files removed, tracked
//     modifications restored)
//
// Covers all four e2e tests:
//   - "uncommitted files banner" (isomorphic git)
//   - "uncommitted files banner with native git"
//   - "discard all uncommitted changes" (isomorphic git)
//   - "discard all uncommitted changes with native git"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerGithubBranchHandlers } from "@/ipc/handlers/git_branch_handlers";
import { getRegisteredHandlerForTesting } from "@/ipc/handlers/base";
import { writeSettings } from "@/main/settings";

interface UncommittedFile {
  path: string;
  status: string;
}

describe("uncommitted files banner (integration)", () => {
  let harness: ChatFlowHarness;

  const invoke = (channel: string, input: unknown): Promise<any> =>
    Promise.resolve(
      getRegisteredHandlerForTesting(channel)(undefined as never, input),
    );

  const getUncommittedFiles = (): Promise<UncommittedFile[]> =>
    invoke("git:get-uncommitted-files", { appId: harness.appId });

  const gitInApp = (...args: string[]): string =>
    execFileSync("git", args, { cwd: harness.appDir, stdio: "pipe" })
      .toString()
      .trim();

  const runCommitCycle = async (suffix: string) => {
    // Clean state: the banner would not show.
    expect(await getUncommittedFiles()).toEqual([]);

    // Create a new file (tests "added" status).
    const newFileName = `new-file-${suffix}.txt`;
    fs.writeFileSync(
      path.join(harness.appDir, newFileName),
      "New file content for E2E test",
    );

    // Modify an existing file (tests "modified" status).
    const indexPath = path.join(harness.appDir, "index.html");
    const originalIndex = fs.readFileSync(indexPath, "utf-8");
    fs.writeFileSync(indexPath, originalIndex + "\n<!-- Modified for test -->");

    // The banner appears, and the changed-files list shows both files with
    // their statuses.
    const uncommitted = await getUncommittedFiles();
    expect(uncommitted).toContainEqual({ path: newFileName, status: "added" });
    expect(uncommitted).toContainEqual({
      path: "index.html",
      status: "modified",
    });

    // Commit with a custom message via the dialog's commit button.
    const testCommitMessage = `E2E test commit - uncommitted files banner (${suffix})`;
    const commitHash = await invoke("git:commit-changes", {
      appId: harness.appId,
      message: testCommitMessage,
    });
    expect(commitHash).toMatch(/^[0-9a-f]{40}$/);

    // The commit was actually made with the correct message...
    expect(gitInApp("log", "-1", "--format=%s")).toBe(testCommitMessage);
    expect(gitInApp("rev-parse", "HEAD")).toBe(commitHash);

    // ...and contains the files.
    const lastCommitFiles = gitInApp(
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "HEAD",
    );
    expect(lastCommitFiles).toContain(newFileName);
    expect(lastCommitFiles).toContain("index.html");

    // The banner disappears after the commit.
    expect(await getUncommittedFiles()).toEqual([]);
  };

  const runDiscardCycle = async (suffix: string) => {
    // Clean state.
    expect(await getUncommittedFiles()).toEqual([]);

    // Create a new (untracked) file.
    const discardFileName = `discard-test-${suffix}.txt`;
    const discardFilePath = path.join(harness.appDir, discardFileName);
    fs.writeFileSync(discardFilePath, "This file should be discarded");

    // Modify an existing file.
    const indexPath = path.join(harness.appDir, "index.html");
    const originalIndex = fs.readFileSync(indexPath, "utf-8");
    fs.writeFileSync(
      indexPath,
      originalIndex + "\n<!-- Should be discarded -->",
    );

    // The banner appears and lists the new file.
    const uncommitted = await getUncommittedFiles();
    expect(uncommitted.map((f) => f.path)).toContain(discardFileName);

    // "Discard all" + confirm -> git:discard-changes.
    await invoke("git:discard-changes", { appId: harness.appId });

    // The new file was removed and the modified file restored.
    expect(fs.existsSync(discardFilePath)).toBe(false);
    expect(fs.readFileSync(indexPath, "utf-8")).toBe(originalIndex);

    // The banner disappears.
    expect(await getUncommittedFiles()).toEqual([]);
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      enableNativeGit: true,
    });
    registerGithubBranchHandlers();

    // Mirror the e2e setup: a basic chat turn first (no code changes).
    const { result } = await harness.streamChat("tc=basic");
    expect(result).toBe(harness.chatId);
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("uncommitted files banner (isomorphic git)", async () => {
    writeSettings({ enableNativeGit: false });
    await runCommitCycle("iso");
  }, 60_000);

  it("uncommitted files banner with native git", async () => {
    writeSettings({ enableNativeGit: true });
    await runCommitCycle("native");
  }, 60_000);

  it("discard all uncommitted changes (isomorphic git)", async () => {
    writeSettings({ enableNativeGit: false });
    await runDiscardCycle("iso");
  }, 60_000);

  it("discard all uncommitted changes with native git", async () => {
    writeSettings({ enableNativeGit: true });
    await runDiscardCycle("native");
  }, 60_000);
});

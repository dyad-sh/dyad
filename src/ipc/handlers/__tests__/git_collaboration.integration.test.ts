// @vitest-environment node
//
// Migrated from e2e-tests/git_collaboration.spec.ts.
//
// The e2e drove the branch-manager / collaborator UI. Dialog and accordion
// interactions are dropped; the backend behaviors are ported:
//  - branch lifecycle: create (github:create-branch, incl. a source branch),
//    switch (github:switch-branch), rename (github:rename-branch), merge
//    (github:merge-branch — the merged file lands on main, workspace stays
//    clean) and delete (github:delete-branch);
//  - github:pull succeeds when the remote has no changes and leaves the
//    workspace clean;
//  - inviting and removing collaborators against the fake GitHub API;
//  - merge conflicts: github:merge-branch rejects with MergeConflictError,
//    github:get-conflicts lists the conflicted file, and the "Resolve merge
//    conflicts with AI" flow (a new chat streaming the resolver prompt)
//    rewrites the file without conflict markers and completes the merge
//    (no .git/MERGE_HEAD left);
//  - "Cancel sync" aborts the merge (github:merge-abort): conflict markers
//    are gone, the file is back to the main-branch content.
//
// Environment notes: github_handlers bakes its GitHub base URLs at module
// load from E2E_TEST_BUILD + FAKE_LLM_PORT, so both are set in vi.hoisted and
// a second fake-LLM server instance is bound to that fixed port for the
// GitHub API/git routes (the harness's own ephemeral-port instance still
// serves the LLM + catalog traffic).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // github_handlers.ts computes its GitHub endpoints at module load:
  // IS_TEST_BUILD (E2E_TEST_BUILD) routes them to the fake server at
  // http://localhost:<FAKE_LLM_PORT>. Pick a per-process port so parallel
  // test files never collide.
  process.env.E2E_TEST_BUILD = "true";
  const githubPort = 21000 + (process.pid % 20000);
  process.env.FAKE_LLM_PORT = String(githubPort);
  return { ipcHandlers: new Map(), githubPort };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerGithubHandlers } from "@/ipc/handlers/github_handlers";
import { registerGithubBranchHandlers } from "@/ipc/handlers/git_branch_handlers";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { writeSettings } from "@/main/settings";
import { db } from "@/db";
import { chats } from "@/db/schema";
import {
  startFakeLlmServer,
  type FakeLlmServerHandle,
} from "../../../../testing/fake-llm-server/index";

const FAKE_TOKEN = "fake_access_token_12345";

function makeEvent() {
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: () => {},
    },
  };
}

async function invoke(channel: string, params?: unknown): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(), params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

/** The exact prompt useResolveMergeConflictsWithAI builds for one conflict. */
function resolveConflictsPrompt(conflictFiles: string[]): string {
  const fileList = conflictFiles.map((f) => `- ${f}`).join("\n");
  return `Please resolve the Git merge conflicts in the following file${conflictFiles.length > 1 ? "s" : ""}:

${fileList}

For each file, review the conflict markers (<<<<<<<, =======, >>>>>>>) and choose the best resolution that preserves the intended functionality from both sides. Remove all conflict markers and provide the complete resolved file content.`;
}

describe("git collaboration (integration)", () => {
  let harness: ChatFlowHarness;
  let githubServer: FakeLlmServerHandle;

  const appId = () => harness.appId;

  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.email=test@example.com",
        "-c",
        "user.name=Test User",
        ...args,
      ],
      { cwd: harness.appDir, stdio: "pipe" },
    )
      .toString()
      .trim();

  const currentBranch = () => git("branch", "--show-current");
  const mergeHeadExists = () =>
    fs.existsSync(path.join(harness.appDir, ".git", "MERGE_HEAD"));

  const listBranches = async (): Promise<{
    branches: string[];
    current: string | null;
  }> => invoke("github:list-local-branches", { appId: appId() });

  const uncommittedFiles = async (): Promise<unknown[]> =>
    invoke("git:get-uncommitted-files", { appId: appId() });

  const commitAll = async (message: string): Promise<string> =>
    invoke("git:commit-changes", { appId: appId(), message });

  const writeAppFile = (rel: string, content: string) =>
    fs.writeFileSync(path.join(harness.appDir, rel), content);

  /**
   * Mirrors the e2e createGitConflict helper: a file committed on main, a
   * feature branch modifying it, main modifying it too, then a merge that
   * conflicts (leaving the repo mid-merge).
   */
  async function createGitConflict(file: string, branch: string) {
    writeAppFile(file, "Line 1\nLine 2\nLine 3");
    await commitAll(`Add ${file}`);

    await invoke("github:create-branch", { appId: appId(), branch });
    await invoke("github:switch-branch", { appId: appId(), branch });
    writeAppFile(file, "Line 1\nLine 2 Modified Feature\nLine 3");
    await commitAll(`Modify ${file} on ${branch}`);

    await invoke("github:switch-branch", { appId: appId(), branch: "main" });
    writeAppFile(file, "Line 1\nLine 2 Modified Main\nLine 3");
    await commitAll(`Modify ${file} on main`);

    // (The handler throws MergeConflictError; the IPC envelope rebuilds it as
    // a DyadError, so match on the conflict message.)
    await expect(
      invoke("github:merge-branch", { appId: appId(), branch }),
    ).rejects.toThrow(/merge conflict/i);

    // The repo is mid-merge with the file in conflict.
    const conflicts = await invoke("github:get-conflicts", { appId: appId() });
    expect(conflicts).toEqual([file]);
    const state = await invoke("github:get-git-state", { appId: appId() });
    expect(state.mergeInProgress).toBe(true);
    expect(harness.readAppFile(file)).toMatch(/<<<<<<<|=======|>>>>>>>/);
  }

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerGithubHandlers();
    registerGithubBranchHandlers();
    // Fixed-port instance serving the GitHub API + git-over-HTTP routes that
    // github_handlers baked in at module load.
    githubServer = await startFakeLlmServer({
      port: h.githubPort,
      host: "0.0.0.0",
    });
    // The e2e connected via the device flow; the resulting state is the fake
    // token in settings (the device flow itself is covered by the github
    // integration spec).
    writeSettings({ githubAccessToken: { value: FAKE_TOKEN } });
    // The two conflict tests share one repo and use identical conflict hunks;
    // a machine-level rerere config would silently replay the first test's
    // resolution in the second. Pin it off for determinism.
    git("config", "rerere.enabled", "false");
  }, 60_000);

  afterAll(async () => {
    await githubServer?.close().catch(() => {});
    await harness?.dispose();
  });

  it("creates, switches, renames, merges, and deletes branches", async () => {
    // Mirror the e2e setup: a chat turn plus a fresh connected repo.
    await harness.streamChat("tc=basic");
    await invoke("github:create-repo", {
      org: "",
      repo: "test-git-collab",
      appId: appId(),
    });

    // 1. Create a new branch (the UI auto-switches to it after creating).
    await invoke("github:create-branch", {
      appId: appId(),
      branch: "feature-1",
    });
    await invoke("github:switch-branch", {
      appId: appId(),
      branch: "feature-1",
    });
    expect((await listBranches()).branches).toContain("feature-1");
    expect(currentBranch()).toBe("feature-1");

    // 2. Create a branch from a source branch (feature-2 from feature-1).
    await invoke("github:switch-branch", { appId: appId(), branch: "main" });
    await invoke("github:create-branch", {
      appId: appId(),
      branch: "feature-2",
      from: "feature-1",
    });
    await invoke("github:switch-branch", {
      appId: appId(),
      branch: "feature-2",
    });
    expect(currentBranch()).toBe("feature-2");
    expect(await uncommittedFiles()).toEqual([]);

    // 3. Rename feature-2 → feature-2-renamed (from main, like the e2e).
    await invoke("github:switch-branch", { appId: appId(), branch: "main" });
    await invoke("github:rename-branch", {
      appId: appId(),
      oldBranch: "feature-2",
      newBranch: "feature-2-renamed",
    });
    const afterRename = await listBranches();
    expect(afterRename.branches).toContain("feature-2-renamed");
    expect(afterRename.branches).not.toContain("feature-2");

    // 4. Merge: commit a file on feature-1, merge into main.
    await invoke("github:switch-branch", {
      appId: appId(),
      branch: "feature-1",
    });
    const featureContent = "Content from feature-1 branch";
    writeAppFile("merge-test.txt", featureContent);
    await commitAll("Add merge test file");

    await invoke("github:switch-branch", { appId: appId(), branch: "main" });
    expect(harness.appFileExists("merge-test.txt")).toBe(false);

    await invoke("github:merge-branch", {
      appId: appId(),
      branch: "feature-1",
    });
    expect(harness.appFileExists("merge-test.txt")).toBe(true);
    expect(harness.readAppFile("merge-test.txt")).toBe(featureContent);
    expect(await uncommittedFiles()).toEqual([]);
    expect(currentBranch()).toBe("main");

    // 5. Delete feature-1.
    await invoke("github:delete-branch", {
      appId: appId(),
      branch: "feature-1",
    });
    expect((await listBranches()).branches).not.toContain("feature-1");
  }, 60_000);

  it("pulls changes from remote", async () => {
    await invoke("github:create-repo", {
      org: "",
      repo: "test-git-pull",
      appId: appId(),
    });

    const fileContent = "Initial content";
    writeAppFile("pull-test.txt", fileContent);
    await commitAll("Add pull test file");

    // Pull with no remote changes succeeds (the empty remote branch is
    // tolerated) and leaves the working tree untouched and clean.
    await invoke("github:pull", { appId: appId() });

    expect(harness.appFileExists("pull-test.txt")).toBe(true);
    expect(harness.readAppFile("pull-test.txt")).toBe(fileContent);
    expect(await uncommittedFiles()).toEqual([]);
  }, 60_000);

  it("invites and removes collaborators", async () => {
    await invoke("github:create-repo", {
      org: "",
      repo: "test-git-collab-invite",
      appId: appId(),
    });

    const fakeUser = "test-user-123";
    await invoke("github:invite-collaborator", {
      appId: appId(),
      username: fakeUser,
    });

    let collaborators = await invoke("github:list-collaborators", {
      appId: appId(),
    });
    expect(collaborators.map((c: any) => c.login)).toContain(fakeUser);

    await invoke("github:remove-collaborator", {
      appId: appId(),
      username: fakeUser,
    });
    collaborators = await invoke("github:list-collaborators", {
      appId: appId(),
    });
    expect(collaborators.map((c: any) => c.login)).not.toContain(fakeUser);
  }, 60_000);

  it("resolves merge conflicts with AI", async () => {
    await invoke("github:create-repo", {
      org: "",
      repo: "test-git-conflict",
      appId: appId(),
    });
    await createGitConflict("conflict.txt", "feature-conflict");

    // "Resolve merge conflicts with AI" creates a new chat and streams the
    // resolver prompt; the fake LLM answers with a dyad-write of the resolved
    // file and auto-approve commits it, completing the merge.
    const [conflictChat] = await db
      .insert(chats)
      .values({ appId: appId() })
      .returning();
    const { result } = await harness.streamChat(
      resolveConflictsPrompt(["conflict.txt"]),
      { chatId: conflictChat.id },
    );
    expect(result).toBe(conflictChat.id);

    const resolved = harness.readAppFile("conflict.txt");
    expect(resolved).not.toMatch(/<<<<<<<|=======|>>>>>>>/);
    expect(resolved).toContain("Line 2 Modified Feature");

    // The merge completed: no MERGE_HEAD, no conflicts, clean state.
    expect(mergeHeadExists()).toBe(false);
    const state = await invoke("github:get-git-state", { appId: appId() });
    expect(state.mergeInProgress).toBe(false);
    expect(await invoke("github:get-conflicts", { appId: appId() })).toEqual(
      [],
    );
  }, 60_000);

  it("cancels sync when merge conflicts occur", async () => {
    await createGitConflict("conflict2.txt", "feature-conflict-2");

    // "Cancel sync" aborts the in-progress merge.
    await invoke("github:merge-abort", { appId: appId() });

    const state = await invoke("github:get-git-state", { appId: appId() });
    expect(state.mergeInProgress).toBe(false);
    expect(mergeHeadExists()).toBe(false);
    expect(await invoke("github:get-conflicts", { appId: appId() })).toEqual(
      [],
    );

    // The file is back to the main-branch content, conflict markers gone.
    const content = harness.readAppFile("conflict2.txt");
    expect(content).toBe("Line 1\nLine 2 Modified Main\nLine 3");
    expect(await uncommittedFiles()).toEqual([]);
  }, 60_000);
});

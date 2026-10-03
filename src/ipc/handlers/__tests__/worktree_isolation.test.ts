// @vitest-environment node
//
// Node chat-flow integration test (plain `.test.ts` suffix because the harness
// owns its Electron mock; see rules/hybrid-testing.md).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

// Real validation installs dependencies and runs the app's build; the
// integration flow under test only needs a deterministic verdict.
const validation = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/ipc/services/workspace_validation", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/ipc/services/workspace_validation")
    >();
  return {
    ...actual,
    validateWorkspace: vi.fn(async () => {
      validation.calls++;
      return {
        passed: true,
        checks: [
          { name: "install", outcome: "passed", summary: "Installed." },
          { name: "type-check", outcome: "passed", summary: "No errors." },
          { name: "build", outcome: "passed", summary: "Built." },
          {
            name: "test",
            outcome: "missing",
            summary: 'package.json has no "test" script.',
          },
        ],
      };
    }),
  };
});

import { and, asc, eq } from "drizzle-orm";
import { chatStreamDefinition } from "@/chat_stream/definition";
import { remoteMachineHost } from "@/ipc/services/distributed_machine_actor_host";
import { apps, chats, chatWorkspaces, messages } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import { undoIsolatedChatTurns } from "@/ipc/services/workspace_turn_undo";
import { chatWorkspaceRegistry } from "@/ipc/services/chat_workspace_registry";
import { chatWorkspaceService } from "@/ipc/services/chat_workspace_service";
import {
  getWorkspaceAppPath,
  getWorkspaceForChat,
  listIntegrationsForChat,
} from "@/ipc/services/chat_workspace_store";
import { workspaceIntegrationQueue } from "@/ipc/services/workspace_integration_queue";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("worktree isolation (integration)", () => {
  let harness: ChatFlowHarness;
  // The fixture repository's branch depends on the machine's git default.
  let targetBranch: string;
  // Chats isolated by the first two scenarios; later scenarios build on them.
  let featureChatId: number;
  let conflictChatId: number;
  let buildChatId: number;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      autoApprove: true,
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        enableWorktreeIsolation: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
    // Conflict resolution resumes the chat through its main-owned actor,
    // which the node harness does not register on its own.
    try {
      remoteMachineHost.register(chatStreamDefinition);
    } catch (error) {
      if (!/is already registered/.test(String(error))) throw error;
    }
    await chatWorkspaceService.recover();
    targetBranch = git(["branch", "--show-current"]);
  }, 60_000);

  afterAll(async () => {
    workspaceIntegrationQueue.stop();
    await remoteMachineHost
      .disposeMachine(chatStreamDefinition.id)
      .catch(() => undefined);
    await harness?.dispose();
  });

  function git(args: string[], cwd = harness.appDir): string {
    return execFileSync("git", args, { cwd }).toString().trim();
  }

  function isAncestor(ancestor: string, descendant: string): boolean {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", ancestor, descendant],
        {
          cwd: harness.appDir,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  async function createChat(): Promise<number> {
    const [chat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning({ id: chats.id });
    return chat.id;
  }

  async function lastAssistant(chatId: number) {
    const rows = await harness.db.query.messages.findMany({
      where: and(eq(messages.chatId, chatId), eq(messages.role, "assistant")),
      orderBy: [asc(messages.id)],
    });
    return rows.at(-1)!;
  }

  /** No writable turn running and no integration step pending. */
  async function waitForQuietApp() {
    await vi.waitFor(
      () => {
        expect(chatWorkspaceRegistry.getWritableChatIds(harness.appId)).toEqual(
          [],
        );
        expect(workspaceIntegrationQueue.isAppBusy(harness.appId)).toBe(false);
      },
      { timeout: 30_000, interval: 50 },
    );
  }

  async function startSlowWriter(fixture: string) {
    await waitForQuietApp();
    const chatId = await createChat();
    const turn = harness.streamChat(`tc=local-agent/${fixture}`, { chatId });
    // Wait until it has claimed the app's original folder.
    await vi.waitFor(
      () =>
        expect(
          chatWorkspaceRegistry.getWritableChatIds(harness.appId),
        ).toContain(chatId),
      { timeout: 15_000, interval: 25 },
    );
    return { chatId, turn };
  }

  it("isolates a concurrent writer and merges its work after validation", async () => {
    const slow = await startSlowWriter("workspace-isolation-slow-feature");
    const isolatedChatId = await createChat();
    featureChatId = isolatedChatId;

    const isolatedTurn = await harness.streamChat(
      "tc=local-agent/workspace-isolation-fast-feature",
      { chatId: isolatedChatId },
    );
    expect(isolatedTurn.event("chat:response:error")).toBeUndefined();

    // The second writer got its own branch and folder from committed state.
    const workspace = getWorkspaceForChat(isolatedChatId);
    expect(workspace).toMatchObject({
      branch: `dyad/chat-${isolatedChatId}`,
      targetBranch,
      status: "active",
    });
    expect(getWorkspaceForChat(slow.chatId)).toBeUndefined();
    const workspacePath = getWorkspaceAppPath(workspace!);
    expect(fs.existsSync(path.join(workspacePath, "src/feature-b.ts"))).toBe(
      true,
    );
    // Not merged while the other agent still owns the original folder.
    expect(harness.appFileExists("src/feature-b.ts")).toBe(false);

    // The turn's checkpoint is on the workspace branch and durably linked.
    const isolatedReply = await lastAssistant(isolatedChatId);
    expect(isolatedReply.commitHash).toBeTruthy();
    expect(isolatedReply.sourceCommitHash).toBe(workspace!.baseCommit);
    const commitMessage = git(
      ["log", "-1", "--format=%B", isolatedReply.commitHash!],
      workspacePath,
    );
    expect(commitMessage).toContain(`Dyad-Chat: ${isolatedChatId}`);
    expect(commitMessage).toContain(`Dyad-Turn: ${isolatedReply.id}`);
    expect(commitMessage).toContain(
      "Requested: tc=local-agent/workspace-isolation-fast-feature",
    );

    await slow.turn;
    expect(harness.appFileExists("src/feature-a.ts")).toBe(true);

    await vi.waitFor(
      () =>
        expect(getWorkspaceForChat(isolatedChatId)?.integrationStatus).toBe(
          "merged",
        ),
      { timeout: 30_000, interval: 50 },
    );
    expect(harness.appFileExists("src/feature-a.ts")).toBe(true);
    expect(harness.appFileExists("src/feature-b.ts")).toBe(true);
    expect(git(["status", "--porcelain"])).toBe("");

    // Merges, never rebases: both chats' checkpoints stay in main's history.
    const slowReply = await lastAssistant(slow.chatId);
    expect(isAncestor(slowReply.commitHash!, targetBranch)).toBe(true);
    expect(isAncestor(isolatedReply.commitHash!, targetBranch)).toBe(true);

    // Integration results are recorded separately from the turn's hashes.
    const [record] = listIntegrationsForChat(isolatedChatId);
    expect(record).toMatchObject({
      status: "merged",
      messageId: isolatedReply.id,
      sourceCommitHash: isolatedReply.commitHash,
      integratedCommitHash: git(["rev-parse", targetBranch]),
    });
    expect(record.validationJson).toContainEqual(
      expect.objectContaining({ name: "test", outcome: "missing" }),
    );
    // Validated before chat A committed and again after merging its commit;
    // waiting for the original folder must not re-run the attempt in a loop.
    expect(validation.calls).toBeGreaterThan(0);
    expect(validation.calls).toBeLessThanOrEqual(3);
    // The workspace is retained for the chat's next turn.
    expect(fs.existsSync(workspacePath)).toBe(true);
  }, 90_000);

  it("resumes the originating chat to resolve conflicts before merging", async () => {
    const slow = await startSlowWriter("workspace-isolation-slow-shared");
    const isolatedChatId = await createChat();
    conflictChatId = isolatedChatId;
    await harness.streamChat("tc=local-agent/workspace-isolation-fast-shared", {
      chatId: isolatedChatId,
    });
    expect(getWorkspaceForChat(isolatedChatId)?.status).toBe("active");
    await slow.turn;
    expect(harness.readAppFile("src/shared.ts")).toBe(
      'export const shared = "A";\n',
    );

    await vi.waitFor(
      () =>
        expect(getWorkspaceForChat(isolatedChatId)?.integrationStatus).toBe(
          "merged",
        ),
      { timeout: 60_000, interval: 50 },
    );
    // The resolution from the resumed chat landed, keeping both intents.
    expect(harness.readAppFile("src/shared.ts")).toBe(
      'export const shared = "A and B";\n',
    );

    // Dyad resumed the originating chat with context from both tasks.
    const userPrompts = (
      await harness.db.query.messages.findMany({
        where: and(
          eq(messages.chatId, isolatedChatId),
          eq(messages.role, "user"),
        ),
        orderBy: [asc(messages.id)],
      })
    ).map((message) => message.content);
    const repairPrompt = userPrompts.at(-1)!;
    expect(repairPrompt).toMatch(/^\[Dyad\] Combine this chat's work/);
    expect(repairPrompt).toContain("- src/shared.ts");
    expect(repairPrompt).toContain(
      "tc=local-agent/workspace-isolation-fast-shared",
    );
    // The other chat's request, found through its durable commit link.
    expect(repairPrompt).toContain("workspace-isolation-slow-shared");

    // The resolution was completed as a merge, so history is preserved.
    const head = git(["rev-parse", targetBranch]);
    expect(git(["log", "-1", "--format=%P", head]).split(" ").length).toBe(2);
    const [record] = listIntegrationsForChat(isolatedChatId);
    expect(record.status).toBe("merged");
    expect(record.mergeCommitHash).toBeTruthy();
  }, 120_000);

  it("synchronizes a fully merged workspace before the chat's next turn", async () => {
    await waitForQuietApp();
    const workspace = getWorkspaceForChat(featureChatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    const main = git(["rev-parse", targetBranch]);
    // Other chats' work landed on the target since this workspace merged.
    expect(git(["rev-parse", "HEAD"], workspacePath)).not.toBe(main);

    await harness.streamChat("tc=local-agent/basic-response", {
      chatId: featureChatId,
    });
    // Fast-forwarded (no rebase, no new commit) before the turn started, so
    // the turn's checkpoint baseline already includes the other work.
    expect(git(["rev-parse", "HEAD"], workspacePath)).toBe(main);
    expect((await lastAssistant(featureChatId)).sourceCommitHash).toBe(main);
    expect(fs.existsSync(path.join(workspacePath, "src/shared.ts"))).toBe(true);
  }, 60_000);

  it("refuses an undo that would discard other chats' merged work", async () => {
    await waitForQuietApp();
    const workspacePath = getWorkspaceAppPath(
      getWorkspaceForChat(conflictChatId)!,
    );
    const head = git(["rev-parse", "HEAD"], workspacePath);
    const [firstUserMessage] = await harness.db.query.messages.findMany({
      where: and(
        eq(messages.chatId, conflictChatId),
        eq(messages.role, "user"),
      ),
      orderBy: [asc(messages.id)],
    });
    // The chat's own change was combined with chat A's on the same lines.
    await expect(
      undoIsolatedChatTurns({
        chatId: conflictChatId,
        fromUserMessageId: firstUserMessage.id,
      }),
    ).rejects.toThrow(/can't be undone automatically/);
    expect(git(["rev-parse", "HEAD"], workspacePath)).toBe(head);
    expect(git(["status", "--porcelain"], workspacePath)).toBe("");
    expect(
      await harness.db.query.messages.findFirst({
        where: eq(messages.id, firstUserMessage.id),
      }),
    ).toBeTruthy();
  }, 60_000);

  it("undoes only the chat's own commits and merges the undo", async () => {
    await waitForQuietApp();
    const workspacePath = getWorkspaceAppPath(
      getWorkspaceForChat(featureChatId)!,
    );
    const [firstUserMessage] = await harness.db.query.messages.findMany({
      where: and(eq(messages.chatId, featureChatId), eq(messages.role, "user")),
      orderBy: [asc(messages.id)],
    });
    const { undoCommit } = await undoIsolatedChatTurns({
      chatId: featureChatId,
      fromUserMessageId: firstUserMessage.id,
    });
    expect(undoCommit).toBeTruthy();
    expect(fs.existsSync(path.join(workspacePath, "src/feature-b.ts"))).toBe(
      false,
    );
    // The undone turns' messages are gone; other chats are untouched.
    expect(
      await harness.db.query.messages.findMany({
        where: eq(messages.chatId, featureChatId),
      }),
    ).toEqual([]);

    await vi.waitFor(
      () => {
        expect(getWorkspaceForChat(featureChatId)?.integrationStatus).toBe(
          "merged",
        );
        expect(harness.appFileExists("src/feature-b.ts")).toBe(false);
      },
      { timeout: 30_000, interval: 50 },
    );
    // Work merged from other chats survives the undo.
    expect(harness.appFileExists("src/feature-a.ts")).toBe(true);
    expect(harness.readAppFile("src/shared.ts")).toBe(
      'export const shared = "A and B";\n',
    );
  }, 60_000);

  it("removes only idle, fully merged workspaces when over capacity", async () => {
    await waitForQuietApp();
    const conflictWorkspace = getWorkspaceForChat(conflictChatId)!;
    const conflictPath = getWorkspaceAppPath(conflictWorkspace);
    const featurePath = getWorkspaceAppPath(
      getWorkspaceForChat(featureChatId)!,
    );
    writeSettings({ worktreeIsolationMaxWorkspacesPerApp: 1 });
    try {
      // Untracked work blocks removal even when the app is over capacity.
      fs.writeFileSync(path.join(conflictPath, "notes.txt"), "keep me");
      fs.writeFileSync(path.join(featurePath, "notes.txt"), "keep me too");
      expect(await chatWorkspaceService.sweepApp(harness.appId)).toBe(0);
      expect(fs.existsSync(conflictPath)).toBe(true);
      expect(fs.existsSync(featurePath)).toBe(true);

      fs.rmSync(path.join(conflictPath, "notes.txt"));
      fs.rmSync(path.join(featurePath, "notes.txt"));
      expect(await chatWorkspaceService.sweepApp(harness.appId)).toBe(1);
      const remaining = [featureChatId, conflictChatId].filter(
        (chatId) => getWorkspaceForChat(chatId) !== undefined,
      );
      expect(remaining).toHaveLength(1);
      const removedChatId =
        remaining[0] === featureChatId ? conflictChatId : featureChatId;
      const removedPath =
        removedChatId === featureChatId ? featurePath : conflictPath;
      expect(fs.existsSync(removedPath)).toBe(false);
      // Merged branches go with the workspace; chat history stays.
      expect(git(["branch", "--list", `dyad/chat-${removedChatId}`])).toBe("");
      expect(
        (
          await harness.db.query.chats.findFirst({
            where: eq(chats.id, removedChatId),
          })
        )?.id,
      ).toBe(removedChatId);
      expect(listIntegrationsForChat(removedChatId).length).toBeGreaterThan(0);
    } finally {
      writeSettings({ worktreeIsolationMaxWorkspacesPerApp: undefined });
    }
  }, 60_000);

  it("recovers integration state from Git after a restart", async () => {
    await waitForQuietApp();
    const chatId = [featureChatId, conflictChatId].find(
      (id) => getWorkspaceForChat(id) !== undefined,
    )!;
    const workspace = getWorkspaceForChat(chatId)!;
    // The fast-forward landed but the process died before saving "merged".
    harness.db
      .update(chatWorkspaces)
      .set({ integrationStatus: "integrating", integrationDetail: null })
      .where(eq(chatWorkspaces.id, workspace.id))
      .run();
    await chatWorkspaceService.recover();
    expect(getWorkspaceForChat(chatId)?.integrationStatus).toBe("merged");

    // A repair turn cannot survive a restart: ask the user to continue.
    harness.db
      .update(chatWorkspaces)
      .set({ integrationStatus: "resolving-conflicts" })
      .where(eq(chatWorkspaces.id, workspace.id))
      .run();
    await chatWorkspaceService.recover();
    expect(getWorkspaceForChat(chatId)).toMatchObject({
      integrationStatus: "paused",
    });
    expect(getWorkspaceForChat(chatId)?.integrationDetail).toMatch(/restarted/);
  }, 60_000);
  it("reconnects a workspace after the app folder moves and follows a renamed target", async () => {
    await waitForQuietApp();
    const chatId = [featureChatId, conflictChatId].find(
      (id) => getWorkspaceForChat(id) !== undefined,
    )!;
    const workspace = getWorkspaceForChat(chatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    const originalDir = harness.appDir;
    const movedDir = `${originalDir}-moved`;
    const renamedBranch = `${targetBranch}-renamed`;
    const setAppPath = (appPath: string) =>
      harness.db
        .update(apps)
        .set({ path: appPath })
        .where(eq(apps.id, harness.appId))
        .run();
    // Renaming or relocating an app copies its folder and deletes the old one.
    fs.cpSync(originalDir, movedDir, { recursive: true });
    fs.rmSync(originalDir, { recursive: true, force: true });
    setAppPath(movedDir);
    try {
      expect(() => git(["status"], workspacePath)).toThrow();
      // Nothing reconnected the workspace, so the chat's next turn does.
      const turn = await harness.streamChat("tc=local-agent/basic-response", {
        chatId,
      });
      expect(turn.event("chat:response:error")).toBeUndefined();
      expect(git(["status", "--porcelain"], workspacePath)).toBe("");
      expect(git(["worktree", "list", "--porcelain"], movedDir)).toContain(
        workspace.path,
      );

      // Renaming the target is not switching away from it.
      git(["branch", "-m", targetBranch, renamedBranch], movedDir);
      chatWorkspaceService.onBranchRenamed({
        appId: harness.appId,
        oldBranch: targetBranch,
        newBranch: renamedBranch,
      });
      expect(getWorkspaceForChat(chatId)?.targetBranch).toBe(renamedBranch);
    } finally {
      await waitForQuietApp();
      if (git(["branch", "--list", renamedBranch], movedDir)) {
        git(["branch", "-m", renamedBranch, targetBranch], movedDir);
        chatWorkspaceService.onBranchRenamed({
          appId: harness.appId,
          oldBranch: renamedBranch,
          newBranch: targetBranch,
        });
      }
      fs.cpSync(movedDir, originalDir, { recursive: true });
      fs.rmSync(movedDir, { recursive: true, force: true });
      setAppPath(originalDir);
      await chatWorkspaceService.reconnectAfterAppMove(harness.appId);
    }
    expect(git(["status", "--porcelain"], workspacePath)).toBe("");
  }, 60_000);
  it("applies a concurrent Build-mode response in its own workspace", async () => {
    const slow = await startSlowWriter("workspace-isolation-slow-feature");
    const [buildChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "build" })
      .returning({ id: chats.id });
    buildChatId = buildChat.id;
    const before = harness.appFileExists("src/pages/Index.tsx")
      ? harness.readAppFile("src/pages/Index.tsx")
      : null;

    const turn = await harness.streamChat("tc=write-index-2", {
      chatId: buildChat.id,
    });
    expect(turn.event("chat:response:error")).toBeUndefined();
    const workspace = getWorkspaceForChat(buildChat.id)!;
    expect(workspace.status).toBe("active");
    const workspacePath = getWorkspaceAppPath(workspace);
    // Written where the response was generated, not into the folder the
    // other chat's agent is still working in.
    expect(
      fs.readFileSync(path.join(workspacePath, "src/pages/Index.tsx"), "utf8"),
    ).toContain("Testing:write-index(2)!");
    expect(
      harness.appFileExists("src/pages/Index.tsx")
        ? harness.readAppFile("src/pages/Index.tsx")
        : null,
    ).toBe(before);
    const reply = await lastAssistant(buildChat.id);
    expect(
      git(["log", "-1", "--format=%B", reply.commitHash!], workspacePath),
    ).toContain(`Dyad-Chat: ${buildChat.id}`);

    await slow.turn;
    await vi.waitFor(
      () =>
        expect(getWorkspaceForChat(buildChat.id)?.integrationStatus).toBe(
          "merged",
        ),
      { timeout: 30_000, interval: 50 },
    );
    expect(harness.readAppFile("src/pages/Index.tsx")).toContain(
      "Testing:write-index(2)!",
    );
  }, 90_000);
  it("applies an approved proposal to the code it was written against", async () => {
    await waitForQuietApp();
    const workspacePath = getWorkspaceAppPath(
      getWorkspaceForChat(buildChatId)!,
    );
    const head = git(["rev-parse", "HEAD"], workspacePath);
    // Another chat's work lands after this chat's proposal was written.
    fs.writeFileSync(
      path.join(harness.appDir, "src/landed.ts"),
      "export const landed = true;\n",
    );
    git(["add", "-A"]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "Land other work",
    ]);
    const prepare = (synchronize?: boolean) =>
      chatWorkspaceService.prepareTurnWorkspace({
        appId: harness.appId,
        chatId: buildChatId,
        originalAppPath: harness.appDir,
        writable: true,
        allowIsolation: true,
        synchronize,
        signal: new AbortController().signal,
      });

    // Merging first would let the proposal's full-file writes overwrite the
    // landed work; integration merges it afterwards instead.
    const approval = await prepare(false);
    try {
      expect(approval.kind).toBe("isolated");
      expect(git(["rev-parse", "HEAD"], workspacePath)).toBe(head);
    } finally {
      await approval.settle();
    }
    // A new turn starts from the latest target.
    const turn = await prepare();
    try {
      expect(fs.existsSync(path.join(workspacePath, "src/landed.ts"))).toBe(
        true,
      );
    } finally {
      await turn.settle();
    }
  }, 60_000);
  it("keeps a chat's working plan in the app folder across isolated turns", async () => {
    await waitForQuietApp();
    const workspacePath = getWorkspaceAppPath(
      getWorkspaceForChat(buildChatId)!,
    );
    const planFile = `chat-${buildChatId}-plan.md`;
    const originalPlan = path.join(harness.appDir, ".dyad", "plans", planFile);
    const workspacePlan = path.join(workspacePath, ".dyad", "plans", planFile);
    fs.mkdirSync(path.dirname(originalPlan), { recursive: true });
    fs.writeFileSync(originalPlan, "- [ ] step one\n");
    const prepare = () =>
      chatWorkspaceService.prepareTurnWorkspace({
        appId: harness.appId,
        chatId: buildChatId,
        originalAppPath: harness.appDir,
        writable: true,
        allowIsolation: true,
        signal: new AbortController().signal,
      });

    // /implement-plan has the agent mark progress with ordinary file tools,
    // which resolve paths inside the workspace.
    let turn = await prepare();
    try {
      expect(fs.readFileSync(workspacePlan, "utf8")).toBe("- [ ] step one\n");
      fs.writeFileSync(workspacePlan, "- [x] step one\n");
      // Mirrored metadata is never uncommitted work.
      expect(git(["status", "--porcelain"], workspacePath)).toBe("");
    } finally {
      await turn.settle();
    }
    expect(fs.readFileSync(originalPlan, "utf8")).toBe("- [x] step one\n");

    // A turn that leaves the plan alone never overwrites a newer edit.
    turn = await prepare();
    try {
      fs.writeFileSync(originalPlan, "- [x] step one\n- [ ] step two\n");
    } finally {
      await turn.settle();
    }
    expect(fs.readFileSync(originalPlan, "utf8")).toBe(
      "- [x] step one\n- [ ] step two\n",
    );
  }, 60_000);
});

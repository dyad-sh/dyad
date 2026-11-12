// @vitest-environment node
//
// Node chat-flow integration test (plain `.test.ts` suffix because the harness
// owns its Electron mock; see rules/hybrid-testing.md).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

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
import { planHandoffDefinition } from "@/plan_handoff/definition";
import { remoteMachineHost } from "@/ipc/services/distributed_machine_actor_host";
import {
  apps,
  chats,
  chatWorkspaces,
  messages,
  versions as versionsTable,
} from "@/db/schema";
import { undoIsolatedChatTurns } from "@/ipc/services/workspace_turn_undo";
import { chatWorkspaceRegistry } from "@/ipc/services/chat_workspace_registry";
import { chatWorkspaceService } from "@/ipc/services/chat_workspace_service";
import {
  getWorkspaceAppPath,
  getWorkspaceForChat,
} from "@/ipc/services/chat_workspace_store";
import { workspaceIntegrationQueue } from "@/ipc/services/workspace_integration_queue";
import { validateWorkspace } from "@/ipc/services/workspace_validation";
import { ensureDyadGitignored } from "@/ipc/handlers/gitignoreUtils";
import { workspaceRuntimeId } from "../../../../shared/workspace_runtime_id";
import { resolvePackageManager } from "@/ipc/services/isolated_package_install";
import * as fileOperations from "@/pro/main/ipc/handlers/local_agent/processors/file_operations";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { createFakeIpcEvent } from "@/testing/electron_mock";
import {
  registerVersionHandlers,
  versionPreviewHandlerService,
} from "@/ipc/handlers/version_handlers";
import { registerChatHandlers } from "@/ipc/handlers/chat_handlers";
import * as gitWorktreeUtils from "@/ipc/utils/git_worktree_utils";
import * as chatJournalCleanup from "@/ipc/services/chat_journal_cleanup";
import type { Version } from "@/ipc/types";
import { listSpecFiles } from "@/ipc/handlers/tests_handlers";
import { queryKeys } from "@/lib/queryKeys";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import { RendererQueryInvalidationConsumer } from "@/window_infrastructure/renderer_query_invalidation";
import {
  QueryInvalidationBatchSchema,
  WindowSessionIdSchema,
} from "@/window_infrastructure/types";

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
    // Deleting a chat also settles its plan handoff actor.
    const registerOnce = (register: () => void) => {
      try {
        register();
      } catch (error) {
        if (!/is already registered/.test(String(error))) throw error;
      }
    };
    registerOnce(() => remoteMachineHost.register(chatStreamDefinition));
    registerOnce(() => remoteMachineHost.register(planHandoffDefinition));
    registerVersionHandlers();
    registerChatHandlers();
    await chatWorkspaceService.recover();
    targetBranch = git(["branch", "--show-current"]);
  }, 60_000);

  afterAll(async () => {
    workspaceIntegrationQueue.stop();
    for (const id of [chatStreamDefinition.id, planHandoffDefinition.id]) {
      await remoteMachineHost.disposeMachine(id).catch(() => undefined);
    }
    await harness?.dispose();
  });

  /** The app's versions, newest first, as the version pane lists them. */
  async function listVersions(): Promise<Version[]> {
    const handler = h.ipcHandlers.get("list-versions");
    if (!handler) throw new Error("list-versions is not registered");
    // Typed handlers answer in an IPC envelope.
    const envelope = (await handler(createFakeIpcEvent([]), {
      appId: harness.appId,
    })) as { ok: boolean; value: Version[] };
    expect(envelope.ok).toBe(true);
    return envelope.value;
  }

  function git(args: string[], cwd = harness.appDir): string {
    return execFileSync("git", args, { cwd }).toString().trim();
  }

  function isAncestor(
    ancestor: string,
    descendant: string,
    cwd = harness.appDir,
  ): boolean {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", ancestor, descendant],
        {
          cwd,
        },
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The target's newest commit is one squash of the chat's worktree: a single
   * parent, the worktree's exact files, trailers naming the chat, worktree,
   * and turns, and recorded in the worktree's own history.
   */
  function expectSquashOf(
    chatId: number,
    { parent }: { parent?: string } = {},
  ) {
    const workspace = getWorkspaceForChat(chatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    const squash = git(["rev-parse", targetBranch]);
    expect(git(["log", "-1", "--format=%P", squash]).split(" ")).toHaveLength(
      1,
    );
    if (parent) expect(git(["rev-parse", `${squash}^`])).toBe(parent);
    const message = git(["log", "-1", "--format=%B", squash]);
    expect(message).toContain(`Dyad-Chat: ${chatId}`);
    expect(message).toContain(`Dyad-Workspace: ${workspace.branch}`);
    expect(git(["rev-parse", `${squash}^{tree}`])).toBe(
      git(["rev-parse", "HEAD^{tree}"], workspacePath),
    );
    expect(isAncestor(squash, "HEAD", workspacePath)).toBe(true);
    // A successful fast-forward is what marks the work integrated.
    expect(workspace.lastIntegratedCommit).toBe(
      git(["rev-parse", "HEAD"], workspacePath),
    );
    return { squash, message };
  }

  /** Whether a squash on the target says it includes this turn. */
  function targetHasTurn(messageId: number): boolean {
    return git([
      "log",
      "--format=%(trailers:key=Dyad-Turn,valueonly)",
      targetBranch,
    ])
      .split("\n")
      .map((line) => line.trim())
      .includes(String(messageId));
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

  async function startSlowWriter(fixture: string, existingChatId?: number) {
    await waitForQuietApp();
    const chatId = existingChatId ?? (await createChat());
    const turn = harness.streamChat(`tc=local-agent/${fixture}`, { chatId });
    // Wait until its writable turn is running.
    await vi.waitFor(
      () =>
        expect(
          chatWorkspaceRegistry.getWritableChatIds(harness.appId),
        ).toContain(chatId),
      { timeout: 15_000, interval: 25 },
    );
    return { chatId, turn };
  }

  /**
   * Holds a chat's checkpoint commit until released, so a scenario decides
   * which of two isolated writers lands first instead of racing them.
   */
  function holdCheckpoint(chatId: number) {
    const commitAllChanges = fileOperations.commitAllChanges;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = { waiting: false };
    const spy = vi
      .spyOn(fileOperations, "commitAllChanges")
      .mockImplementation(async (...args) => {
        if (args[0].chatId === chatId) {
          state.waiting = true;
          await gate;
        }
        return commitAllChanges(...args);
      });
    return {
      isWaiting: () => state.waiting,
      release: () => release(),
      restore: () => {
        release();
        spy.mockRestore();
      },
    };
  }

  async function waitForMerged(chatId: number, timeout = 30_000) {
    await vi.waitFor(
      () =>
        expect(getWorkspaceForChat(chatId)?.integrationStatus).toBe("merged"),
      { timeout, interval: 50 },
    );
  }

  /** Deletes a helper chat's worktree so later scenarios see only theirs. */
  async function discardWorkspace(chatId: number) {
    await waitForQuietApp();
    if (getWorkspaceForChat(chatId)) {
      await chatWorkspaceService.deleteChatWorkspace(chatId);
    }
  }

  /**
   * Lands a hand-made turn in the chat's worktree: the files are committed
   * there, then the turn settles as finished (optionally at its step limit).
   */
  async function landTurn(
    chatId: number,
    files: Record<string, string>,
    {
      stepLimitReached = false,
      uncommitted = {},
    }: {
      stepLimitReached?: boolean;
      /** Left uncommitted after the commit (an install rewriting a lockfile). */
      uncommitted?: Record<string, string>;
    } = {},
  ) {
    const turn = await chatWorkspaceService.prepareTurnWorkspace({
      appId: harness.appId,
      chatId,
      originalAppPath: harness.appDir,
      writable: true,
      allowIsolation: true,
      signal: new AbortController().signal,
    });
    try {
      for (const [relativePath, content] of Object.entries(files)) {
        const target = path.join(turn.appPath, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
      }
      if (Object.keys(files).length > 0) {
        git(["add", "-A"], turn.appPath);
        git(
          [
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            "Hand-made turn",
          ],
          turn.appPath,
        );
      }
      for (const [relativePath, content] of Object.entries(uncommitted)) {
        fs.writeFileSync(path.join(turn.appPath, relativePath), content);
      }
      turn.outcome.completed = true;
      turn.outcome.stepLimitReached = stepLimitReached;
    } finally {
      await turn.settle();
    }
  }

  function commitInApp(files: Record<string, string>, message: string) {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.join(harness.appDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    git(["add", "-A"]);
    git([
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      message,
    ]);
  }

  it("isolates an app's first chat even when no other chat is writing", async () => {
    // The harness app has only its initial commit, like a newly created app,
    // and its first chat is the one created with it.
    const chatId = harness.chatId;
    const initialCommit = git(["rev-parse", targetBranch]);
    const turn = await harness.streamChat("tc=local-agent/write-index", {
      chatId,
    });
    expect(turn.event("chat:response:error")).toBeUndefined();

    const workspace = getWorkspaceForChat(chatId)!;
    expect(workspace).toMatchObject({
      branch: `dyad/chat-${chatId}`,
      targetBranch,
      baseCommit: initialCommit,
      status: "active",
    });
    // Recorded at creation with the same choice its installs make.
    expect(workspace.packageManager).toBe(
      (
        await resolvePackageManager(
          getWorkspaceAppPath(workspace),
          workspace.path,
        )
      ).packageManager,
    );
    const reply = await lastAssistant(chatId);
    expect(reply.sourceCommitHash).toBe(initialCommit);
    expect(
      git(
        ["log", "-1", "--format=%B", reply.commitHash!],
        getWorkspaceAppPath(workspace),
      ),
    ).toContain(`Dyad-Chat: ${chatId}`);

    // Its work reaches the app's branch as one squash on the initial commit;
    // the turn's own checkpoint stays on the worktree branch.
    await waitForMerged(chatId);
    const { squash, message } = expectSquashOf(chatId, {
      parent: initialCommit,
    });
    expect(message).toContain(`Dyad-Turn: ${reply.id}`);
    expect(git(["log", "-1", "--format=%s", squash])).toBe(
      git(
        ["log", "-1", "--format=%s", reply.commitHash!],
        getWorkspaceAppPath(workspace),
      ),
    );
    expect(isAncestor(reply.commitHash!, targetBranch)).toBe(false);
    expect(isAncestor(reply.commitHash!, workspace.branch)).toBe(true);
    expect(git(["status", "--porcelain"])).toBe("");
  }, 60_000);

  it("brings an idle workspace onto a template applied to the app's folder", async () => {
    await waitForQuietApp();
    const chatId = harness.chatId;
    const workspace = getWorkspaceForChat(chatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    // Approving a blueprint applies its template in the app's folder.
    commitInApp(
      { "src/template-marker.ts": "export const template = true;\n" },
      "Apply portal-mini-store template",
    );
    const main = git(["rev-parse", targetBranch]);

    // Uncommitted work in the workspace is never overwritten.
    fs.writeFileSync(path.join(workspacePath, "notes.txt"), "keep me");
    expect(await chatWorkspaceService.synchronizeIdleWorkspace(chatId)).toBe(
      null,
    );
    expect(
      fs.existsSync(path.join(workspacePath, "src/template-marker.ts")),
    ).toBe(false);
    fs.rmSync(path.join(workspacePath, "notes.txt"));

    // The returned runtime is what the blueprint card restarts.
    expect(await chatWorkspaceService.synchronizeIdleWorkspace(chatId)).toBe(
      workspaceRuntimeId(workspace.id),
    );
    expect(isAncestor(main, "HEAD", workspacePath)).toBe(true);
    expect(git(["rev-parse", "HEAD^{tree}"], workspacePath)).toBe(
      git(["rev-parse", `${main}^{tree}`]),
    );
    expect(
      fs.existsSync(path.join(workspacePath, "src/template-marker.ts")),
    ).toBe(true);
    // Nothing more to bring in.
    expect(await chatWorkspaceService.synchronizeIdleWorkspace(chatId)).toBe(
      null,
    );

    // Deleting a merged worktree removes its folder and merged branch; the
    // chat and its history stay.
    await chatWorkspaceService.deleteChatWorkspace(chatId);
    expect(getWorkspaceForChat(chatId)).toBeUndefined();
    expect(fs.existsSync(workspace.path)).toBe(false);
    expect(git(["branch", "--list", workspace.branch])).toBe("");
    expect(
      (await harness.db.query.chats.findFirst({ where: eq(chats.id, chatId) }))
        ?.id,
    ).toBe(chatId);
  }, 60_000);

  it("isolates every writer and merges each one's work after validation", async () => {
    validation.calls = 0;
    const slowChatId = await createChat();
    const slowCheckpoint = holdCheckpoint(slowChatId);
    try {
      const slow = await startSlowWriter(
        "workspace-isolation-slow-feature",
        slowChatId,
      );
      const isolatedChatId = await createChat();
      featureChatId = isolatedChatId;

      const isolatedTurn = await harness.streamChat(
        "tc=local-agent/workspace-isolation-fast-feature",
        { chatId: isolatedChatId },
      );
      expect(isolatedTurn.event("chat:response:error")).toBeUndefined();

      // Each writer got its own branch and folder from committed state.
      const workspace = getWorkspaceForChat(isolatedChatId);
      expect(workspace).toMatchObject({
        branch: `dyad/chat-${isolatedChatId}`,
        targetBranch,
        status: "active",
      });
      expect(getWorkspaceForChat(slow.chatId)).toMatchObject({
        branch: `dyad/chat-${slow.chatId}`,
        targetBranch,
        status: "active",
      });
      const workspacePath = getWorkspaceAppPath(workspace!);
      expect(fs.existsSync(path.join(workspacePath, "src/feature-b.ts"))).toBe(
        true,
      );

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

      // No turn holds the app's folder, so this chat's work lands while the
      // other agent is still running.
      await waitForMerged(isolatedChatId);
      expect(chatWorkspaceRegistry.getWritableChatIds(harness.appId)).toContain(
        slow.chatId,
      );
      expect(harness.appFileExists("src/feature-b.ts")).toBe(true);
      expect(harness.appFileExists("src/feature-a.ts")).toBe(false);
      // One squash of this chat's work, and the checks that ran on it.
      const { squash: isolatedSquash } = expectSquashOf(isolatedChatId);
      const merged = getWorkspaceForChat(isolatedChatId)!;
      expect(merged.validationJson).toContainEqual(
        expect.objectContaining({ name: "test", outcome: "missing" }),
      );

      slowCheckpoint.release();
      expect((await slow.turn).event("chat:response:error")).toBeUndefined();
      await waitForMerged(slow.chatId);
      expect(harness.appFileExists("src/feature-a.ts")).toBe(true);
      expect(harness.appFileExists("src/feature-b.ts")).toBe(true);
      expect(git(["status", "--porcelain"])).toBe("");

      // Each chat's work is one squash on main, in the order it landed; the
      // chats' own checkpoints stay on their worktree branches.
      expectSquashOf(slow.chatId, { parent: isolatedSquash });
      const slowReply = await lastAssistant(slow.chatId);
      expect(targetHasTurn(slowReply.id)).toBe(true);
      expect(targetHasTurn(isolatedReply.id)).toBe(true);
      expect(isAncestor(slowReply.commitHash!, targetBranch)).toBe(false);
      expect(
        isAncestor(
          isolatedReply.commitHash!,
          getWorkspaceForChat(isolatedChatId)!.branch,
        ),
      ).toBe(true);

      // The app's versions are main's commits, newest first, each naming the
      // worktree (and chat) that added it and the turns it holds.
      const versions = await listVersions();
      expect(versions[0]).toMatchObject({
        workspace: {
          branch: getWorkspaceForChat(slow.chatId)!.branch,
          chatId: slow.chatId,
        },
      });
      expect(versions[0].turnMessageIds).toContain(slowReply.id);
      expect(versions[1]).toMatchObject({
        oid: isolatedSquash,
        workspace: {
          branch: getWorkspaceForChat(isolatedChatId)!.branch,
          chatId: isolatedChatId,
        },
      });
      expect(versions[1].turnMessageIds).toContain(isolatedReply.id);
      // The app's initial commit was not made in a worktree.
      expect(versions.at(-1)!.workspace).toBeNull();
      // One validation per attempt; waiting must not re-run an attempt.
      expect(validation.calls).toBeGreaterThanOrEqual(2);
      expect(validation.calls).toBeLessThanOrEqual(3);
      // The workspace is retained for the chat's next turn.
      expect(fs.existsSync(workspacePath)).toBe(true);
    } finally {
      slowCheckpoint.restore();
    }
    await discardWorkspace(slowChatId);
  }, 90_000);

  it("resumes the originating chat to resolve conflicts before merging", async () => {
    const isolatedChatId = await createChat();
    conflictChatId = isolatedChatId;
    // This chat's work lands after the other chat's change to the same lines.
    const checkpoint = holdCheckpoint(isolatedChatId);
    let slowChatId: number | undefined;
    try {
      const slow = await startSlowWriter("workspace-isolation-slow-shared");
      slowChatId = slow.chatId;
      const isolatedTurn = harness.streamChat(
        "tc=local-agent/workspace-isolation-fast-shared",
        { chatId: isolatedChatId },
      );
      await vi.waitFor(() => expect(checkpoint.isWaiting()).toBe(true), {
        timeout: 20_000,
      });
      expect(getWorkspaceForChat(isolatedChatId)?.status).toBe("active");
      expect((await slow.turn).event("chat:response:error")).toBeUndefined();
      await waitForMerged(slow.chatId);
      expect(harness.readAppFile("src/shared.ts")).toBe(
        'export const shared = "A";\n',
      );

      checkpoint.release();
      expect((await isolatedTurn).event("chat:response:error")).toBeUndefined();
      await waitForMerged(isolatedChatId, 60_000);
    } finally {
      checkpoint.restore();
    }
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

    // The resolution was completed as a merge in the worktree; main gets the
    // combined result as one squash on top of the other chat's work.
    expectSquashOf(isolatedChatId);
    expect(
      git(
        ["log", "--merges", "--format=%s", "HEAD"],
        getWorkspaceAppPath(getWorkspaceForChat(isolatedChatId)!),
      ),
    ).toContain(`Combine ${targetBranch} into`);
    await discardWorkspace(slowChatId!);
  }, 120_000);

  it("synchronizes a fully merged workspace before the chat's next turn", async () => {
    await waitForQuietApp();
    const workspace = getWorkspaceForChat(featureChatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    const main = git(["rev-parse", targetBranch]);
    // Other chats' work landed on the target since this workspace merged.
    expect(isAncestor(main, "HEAD", workspacePath)).toBe(false);

    await harness.streamChat("tc=local-agent/basic-response", {
      chatId: featureChatId,
    });
    // Merged in before the turn started (no rebase), so the turn's checkpoint
    // baseline already includes the other work.
    const head = git(["rev-parse", "HEAD"], workspacePath);
    expect(isAncestor(main, head, workspacePath)).toBe(true);
    expect(git(["rev-parse", "HEAD^{tree}"], workspacePath)).toBe(
      git(["rev-parse", `${main}^{tree}`]),
    );
    expect((await lastAssistant(featureChatId)).sourceCommitHash).toBe(head);
    // Bringing in other work is not this chat's work: nothing to merge.
    expect(getWorkspaceForChat(featureChatId)?.lastIntegratedCommit).toBe(head);
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

  it("refuses an undo while the worktree has edits no interrupted turn made", async () => {
    await waitForQuietApp();
    const workspacePath = getWorkspaceAppPath(
      getWorkspaceForChat(featureChatId)!,
    );
    const head = git(["rev-parse", "HEAD"], workspacePath);
    const [firstUserMessage] = await harness.db.query.messages.findMany({
      where: and(eq(messages.chatId, featureChatId), eq(messages.role, "user")),
      orderBy: [asc(messages.id)],
    });
    // Made in the worktree outside Dyad, after the chat's last turn finished.
    const notes = path.join(workspacePath, "notes.txt");
    fs.writeFileSync(notes, "my own notes\n");
    try {
      await expect(
        undoIsolatedChatTurns({
          chatId: featureChatId,
          fromUserMessageId: firstUserMessage.id,
        }),
      ).rejects.toThrow(/uncommitted changes/);
      expect(fs.readFileSync(notes, "utf8")).toBe("my own notes\n");
      expect(git(["rev-parse", "HEAD"], workspacePath)).toBe(head);
      expect(
        await harness.db.query.messages.findFirst({
          where: eq(messages.id, firstUserMessage.id),
        }),
      ).toBeTruthy();
    } finally {
      fs.rmSync(notes, { force: true });
    }
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
    // The worktree preview's install rewrote a lockfile: not the chat's
    // work, so the undo keeps it instead of refusing or reverting it.
    fs.writeFileSync(
      path.join(workspacePath, "package-lock.json"),
      '{"lockfileVersion":3}\n',
    );
    const { undoCommit } = await undoIsolatedChatTurns({
      chatId: featureChatId,
      fromUserMessageId: firstUserMessage.id,
    });
    expect(undoCommit).toBeTruthy();
    expect(fs.existsSync(path.join(workspacePath, "src/feature-b.ts"))).toBe(
      false,
    );
    expect(
      fs.readFileSync(path.join(workspacePath, "package-lock.json"), "utf8"),
    ).toBe('{"lockfileVersion":3}\n');
    expect(git(["status", "--porcelain"], workspacePath)).toBe("");
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

  it("keeps merged worktrees until the user deletes one", async () => {
    await waitForQuietApp();
    const featureWorkspace = getWorkspaceForChat(featureChatId)!;
    const conflictWorkspace = getWorkspaceForChat(conflictChatId)!;
    const conflictPath = getWorkspaceAppPath(conflictWorkspace);
    // Long idle and fully merged is no longer a reason to remove anything,
    // including at startup.
    harness.db
      .update(chatWorkspaces)
      .set({ lastActiveAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .run();
    await chatWorkspaceService.recover();
    expect(getWorkspaceForChat(featureChatId)?.status).toBe("active");
    expect(getWorkspaceForChat(conflictChatId)?.status).toBe("active");
    expect(fs.existsSync(getWorkspaceAppPath(featureWorkspace))).toBe(true);

    // Never under a running turn.
    const turn = await chatWorkspaceService.prepareTurnWorkspace({
      appId: harness.appId,
      chatId: featureChatId,
      originalAppPath: harness.appDir,
      writable: true,
      allowIsolation: true,
      signal: new AbortController().signal,
    });
    try {
      await expect(
        chatWorkspaceService.deleteChatWorkspace(featureChatId),
      ).rejects.toThrow(/in use/);
      expect(getWorkspaceForChat(featureChatId)?.status).toBe("active");
    } finally {
      await turn.settle();
    }

    // Unmerged work can be deleted too: its commits stay on the branch and
    // uncommitted changes go with the folder.
    fs.writeFileSync(path.join(conflictPath, "unmerged.txt"), "kept on branch");
    git(["add", "unmerged.txt"], conflictPath);
    git(
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "Unmerged work",
      ],
      conflictPath,
    );
    const unmergedCommit = git(["rev-parse", "HEAD"], conflictPath);
    fs.writeFileSync(path.join(conflictPath, "notes.txt"), "uncommitted");
    await chatWorkspaceService.deleteChatWorkspace(conflictChatId);
    expect(getWorkspaceForChat(conflictChatId)).toBeUndefined();
    expect(fs.existsSync(conflictWorkspace.path)).toBe(false);
    expect(git(["rev-parse", conflictWorkspace.branch])).toBe(unmergedCommit);
    expect(isAncestor(unmergedCommit, targetBranch)).toBe(false);
    await expect(
      chatWorkspaceService.deleteChatWorkspace(conflictChatId),
    ).rejects.toThrow(/no worktree/);

    // Restoring the app to one of that chat's messages would put a worktree
    // commit (not one of the app's versions) on main: refused.
    const main = git(["rev-parse", targetBranch]);
    const conflictPrompts = await harness.db.query.messages.findMany({
      where: and(
        eq(messages.chatId, conflictChatId),
        eq(messages.role, "user"),
      ),
      orderBy: [asc(messages.id)],
    });
    const restore = await versionPreviewHandlerService.restoreToMessage({
      appId: harness.appId,
      chatId: conflictChatId,
      messageId: conflictPrompts.at(-1)!.id,
      restoreCodebase: true,
    });
    expect(restore.repositoryOutcome).toBe("unchanged");
    expect(restore.notification?.message).toMatch(
      /only exists in a chat's worktree/,
    );
    expect(git(["rev-parse", targetBranch])).toBe(main);

    // A deletion that fails part way keeps the worktree usable, with the
    // files it already deleted back in place.
    const featureAppPath = getWorkspaceAppPath(featureWorkspace);
    const removeSpy = vi
      .spyOn(gitWorktreeUtils, "removeLinkedWorktree")
      .mockImplementationOnce(async () => {
        fs.rmSync(path.join(featureAppPath, "package.json"));
        throw new Error("EBUSY: resource busy or locked");
      });
    try {
      await expect(
        chatWorkspaceService.deleteChatWorkspace(featureChatId),
      ).rejects.toThrow(/EBUSY/);
    } finally {
      removeSpy.mockRestore();
    }
    expect(getWorkspaceForChat(featureChatId)?.status).toBe("active");
    expect(fs.existsSync(featureAppPath)).toBe(true);
    expect(fs.existsSync(path.join(featureAppPath, "package.json"))).toBe(true);
    expect(git(["status", "--porcelain"], featureAppPath)).toBe("");
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
  it("recovers a squash that landed on the target before a restart", async () => {
    await waitForQuietApp();
    const workspace = getWorkspaceForChat(featureChatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    const before = git(["rev-parse", targetBranch]);
    const author = [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
    ];
    // Validated work was squashed onto the target and fast-forwarded, then
    // Dyad stopped before recording it in the worktree or saving "merged".
    fs.writeFileSync(
      path.join(workspacePath, "src/recovered.ts"),
      "export const recovered = true;\n",
    );
    git(["add", "-A"], workspacePath);
    git([...author, "commit", "-m", "Recovered work"], workspacePath);
    const head = git(["rev-parse", "HEAD"], workspacePath);
    const squash = git([
      ...author,
      "commit-tree",
      `${head}^{tree}`,
      "-p",
      before,
      "-m",
      "Squashed work",
    ]);
    git(["merge", "--ff-only", squash]);
    harness.db
      .update(chatWorkspaces)
      .set({
        integrationStatus: "integrating",
        integrationTargetCommit: before,
      })
      .where(eq(chatWorkspaces.id, workspace.id))
      .run();

    await chatWorkspaceService.recover();
    const recovered = getWorkspaceForChat(featureChatId)!;
    expect(recovered.integrationStatus).toBe("merged");
    // The landed squash is now in the worktree history, and that head is the
    // integrated one, so nothing is merged twice.
    expect(isAncestor(squash, "HEAD", workspacePath)).toBe(true);
    expect(recovered.lastIntegratedCommit).toBe(
      git(["rev-parse", "HEAD"], workspacePath),
    );
    expect(git(["rev-parse", targetBranch])).toBe(squash);
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
  it("applies a Build-mode response in the chat's own workspace", async () => {
    await waitForQuietApp();
    const [buildChat] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "build" })
      .returning({ id: chats.id });
    buildChatId = buildChat.id;

    const turn = await harness.streamChat("tc=write-index-2", {
      chatId: buildChat.id,
    });
    expect(turn.event("chat:response:error")).toBeUndefined();
    const workspace = getWorkspaceForChat(buildChat.id)!;
    expect(workspace.status).toBe("active");
    const workspacePath = getWorkspaceAppPath(workspace);
    // Written where the response was generated: the chat's workspace.
    expect(
      fs.readFileSync(path.join(workspacePath, "src/pages/Index.tsx"), "utf8"),
    ).toContain("Testing:write-index(2)!");
    const reply = await lastAssistant(buildChat.id);
    expect(reply.sourceCommitHash).toBe(workspace.baseCommit);
    expect(
      git(["log", "-1", "--format=%B", reply.commitHash!], workspacePath),
    ).toContain(`Dyad-Chat: ${buildChat.id}`);

    await waitForMerged(buildChat.id);
    expect(harness.readAppFile("src/pages/Index.tsx")).toContain(
      "Testing:write-index(2)!",
    );

    // Changing the same lines again merges cleanly: the worktree records its
    // squash, so the next merge with main starts from it rather than from the
    // commit both changes were made against.
    const second = await harness.streamChat("tc=write-index", {
      chatId: buildChat.id,
    });
    expect(second.event("chat:response:error")).toBeUndefined();
    await waitForMerged(buildChat.id);
    expect(getWorkspaceForChat(buildChat.id)?.repairAttempts).toBe(0);
    expect(harness.readAppFile("src/pages/Index.tsx")).toContain(
      "Testing:write-index!",
    );
    expectSquashOf(buildChat.id);

    // And back again: every later round starts from the latest squash.
    const third = await harness.streamChat("tc=write-index-2", {
      chatId: buildChat.id,
    });
    expect(third.event("chat:response:error")).toBeUndefined();
    await waitForMerged(buildChat.id);
    expect(getWorkspaceForChat(buildChat.id)?.repairAttempts).toBe(0);
    expect(harness.readAppFile("src/pages/Index.tsx")).toContain(
      "Testing:write-index(2)!",
    );
    expectSquashOf(buildChat.id);
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
  it("refuses to approve into a merge that started while approval waited", async () => {
    await waitForQuietApp();
    const workspacePath = getWorkspaceAppPath(
      getWorkspaceForChat(buildChatId)!,
    );
    const author = [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
    ];
    const base = git(["rev-parse", "HEAD"], workspacePath);
    git(["branch", "conflicting-target", base], workspacePath);
    fs.writeFileSync(path.join(workspacePath, "src/race.ts"), "ours\n");
    git(["add", "-A"], workspacePath);
    git([...author, "commit", "-m", "Ours"], workspacePath);
    git(["checkout", "-q", "conflicting-target"], workspacePath);
    fs.writeFileSync(path.join(workspacePath, "src/race.ts"), "theirs\n");
    git(["add", "-A"], workspacePath);
    git([...author, "commit", "-m", "Theirs"], workspacePath);
    git(["checkout", "-q", "-"], workspacePath);
    expect(() =>
      git([...author, "merge", "conflicting-target"], workspacePath),
    ).toThrow();
    try {
      await expect(
        chatWorkspaceService.prepareTurnWorkspace({
          appId: harness.appId,
          chatId: buildChatId,
          originalAppPath: harness.appDir,
          writable: true,
          allowIsolation: true,
          synchronize: false,
          refuseWhileMerging:
            "This chat's code is in the middle of combining its work.",
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(/middle of combining/);
      // The refusal released the workspace.
      expect(chatWorkspaceRegistry.getWritableChatIds(harness.appId)).toEqual(
        [],
      );
    } finally {
      git(["merge", "--abort"], workspacePath);
      git(["reset", "-q", "--hard", base], workspacePath);
      git(["branch", "-D", "conflicting-target"], workspacePath);
    }
  }, 60_000);

  it("carries a turn's database restore point to its squash", async () => {
    await waitForQuietApp();
    const workspace = getWorkspaceForChat(buildChatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    const author = [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
    ];
    const turn = await chatWorkspaceService.prepareTurnWorkspace({
      appId: harness.appId,
      chatId: buildChatId,
      originalAppPath: harness.appDir,
      writable: true,
      allowIsolation: true,
      signal: new AbortController().signal,
    });
    try {
      fs.writeFileSync(
        path.join(workspacePath, "src/stamped.ts"),
        "export const stamped = true;\n",
      );
      git(["add", "-A"], workspacePath);
      git([...author, "commit", "-m", "Stamped work"], workspacePath);
      // A Neon app records the database time on the turn's own commit.
      harness.db
        .insert(versionsTable)
        .values({
          appId: harness.appId,
          commitHash: git(["rev-parse", "HEAD"], workspacePath),
          neonDbTimestamp: "2026-11-08T12:00:00Z",
        })
        .run();
      turn.outcome.completed = true;
    } finally {
      await turn.settle();
    }
    await waitForMerged(buildChatId);
    const squash = git(["rev-parse", targetBranch]);
    expect(
      harness.db
        .select()
        .from(versionsTable)
        .where(
          and(
            eq(versionsTable.appId, harness.appId),
            eq(versionsTable.commitHash, squash),
          ),
        )
        .get()?.neonDbTimestamp,
    ).toBe("2026-11-08T12:00:00Z");
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

  it("creates and integrates a held workspace checkpoint after another writer lands", async () => {
    const isolatedChatId = await createChat();
    const checkpoint = holdCheckpoint(isolatedChatId);
    let otherChatId: number | undefined;
    try {
      const other = await startSlowWriter("workspace-isolation-slow-shared");
      otherChatId = other.chatId;
      const isolatedTurn = harness.streamChat("tc=local-agent/write-index", {
        chatId: isolatedChatId,
      });
      await vi.waitFor(() => expect(checkpoint.isWaiting()).toBe(true), {
        timeout: 20_000,
      });
      const workspace = getWorkspaceForChat(isolatedChatId)!;
      expect(workspace.status).toBe("active");
      expect((await other.turn).event("chat:response:error")).toBeUndefined();
      const otherReply = await lastAssistant(other.chatId);
      expect(otherReply.commitHash).toBeTruthy();
      await waitForMerged(other.chatId);
      expect((await lastAssistant(isolatedChatId)).commitHash).toBeNull();

      checkpoint.release();
      expect((await isolatedTurn).event("chat:response:error")).toBeUndefined();
      const isolatedReply = await lastAssistant(isolatedChatId);
      expect(isolatedReply.commitHash).toBeTruthy();
      await waitForMerged(isolatedChatId);
      expect(targetHasTurn(otherReply.id)).toBe(true);
      expect(targetHasTurn(isolatedReply.id)).toBe(true);
      expectSquashOf(isolatedChatId);
      expect(
        git(["status", "--porcelain"], getWorkspaceAppPath(workspace)),
      ).toBe("");
      expect(git(["status", "--porcelain"])).toBe("");
    } finally {
      checkpoint.restore();
    }
    await discardWorkspace(otherChatId!);
  }, 90_000);

  it("waits for a chat working in the app's folder before fast-forwarding", async () => {
    await waitForQuietApp();
    // A turn admitted in the app's folder before isolation was enabled
    // keeps writing there, so the final fast-forward waits for it.
    const sharedChatId = await createChat();
    const shared = await chatWorkspaceService.prepareTurnWorkspace({
      appId: harness.appId,
      chatId: sharedChatId,
      originalAppPath: harness.appDir,
      writable: true,
      allowIsolation: false,
      signal: new AbortController().signal,
    });
    const isolatedChatId = await createChat();
    const validationsBefore = validation.calls;
    try {
      expect(shared.kind).toBe("original");
      const turn = await harness.streamChat(
        "tc=local-agent/workspace-isolation-fast-feature",
        { chatId: isolatedChatId },
      );
      expect(turn.event("chat:response:error")).toBeUndefined();
      await vi.waitFor(
        () =>
          expect(
            getWorkspaceForChat(isolatedChatId)?.integrationDetail,
          ).toMatch(/main folder to finish/),
        { timeout: 30_000, interval: 50 },
      );
      const reply = await lastAssistant(isolatedChatId);
      expect(targetHasTurn(reply.id)).toBe(false);
    } finally {
      await shared.settle();
    }
    await waitForMerged(isolatedChatId);
    expect(targetHasTurn((await lastAssistant(isolatedChatId)).id)).toBe(true);
    expectSquashOf(isolatedChatId);
    // Waiting restarted the attempt, but the validated files had not changed.
    expect(validation.calls - validationsBefore).toBe(1);
    await discardWorkspace(isolatedChatId);
  }, 60_000);

  it("records npm for a worktree whose app installs with npm", async () => {
    await waitForQuietApp();
    const manifest = JSON.parse(harness.readAppFile("package.json"));
    commitInApp(
      {
        "package.json": `${JSON.stringify({ ...manifest, packageManager: "npm@10.9.0" }, null, 2)}\n`,
      },
      "Use npm",
    );
    const chatId = await createChat();
    const turn = await harness.streamChat("tc=local-agent/basic-response", {
      chatId,
    });
    expect(turn.event("chat:response:error")).toBeUndefined();
    // Each npm worktree gets a full node_modules; the chat warns about it.
    expect(getWorkspaceForChat(chatId)?.packageManager).toBe("npm");
    await discardWorkspace(chatId);
  }, 60_000);

  it("refuses restoring a merged chat's checkpoint after its worktree is deleted", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    await landTurn(chatId, { "src/restored.ts": "export const r = 1;\n" });
    await waitForMerged(chatId);
    // This turn starts from a worktree commit that is on no app branch.
    const turn = await harness.streamChat("tc=local-agent/basic-response", {
      chatId,
    });
    expect(turn.event("chat:response:error")).toBeUndefined();
    await waitForMerged(chatId);
    await waitForQuietApp();
    const branch = getWorkspaceForChat(chatId)!.branch;
    const worktreeTip = git(["rev-parse", branch]);
    await chatWorkspaceService.deleteChatWorkspace(chatId);
    // Its work is merged, so the branch went with the worktree.
    expect(git(["branch", "--list", branch])).toBe("");

    const prompts = await harness.db.query.messages.findMany({
      where: and(eq(messages.chatId, chatId), eq(messages.role, "user")),
      orderBy: [asc(messages.id)],
    });
    const main = git(["rev-parse", targetBranch]);
    const restoreLastPrompt = () =>
      versionPreviewHandlerService.restoreToMessage({
        appId: harness.appId,
        chatId,
        messageId: prompts.at(-1)!.id,
        restoreCodebase: true,
      });
    const restore = await restoreLastPrompt();
    expect(restore.repositoryOutcome).toBe("unchanged");
    expect(restore.notification?.message).toMatch(
      /only exists in a chat's worktree/,
    );
    expect(git(["rev-parse", targetBranch])).toBe(main);

    // An ordinary branch that also reaches the checkpoint (one a user cut
    // from the worktree) does not put it in the app branch's history.
    git(["branch", "kept-from-worktree", worktreeTip]);
    try {
      const restoreWithSideBranch = await restoreLastPrompt();
      expect(restoreWithSideBranch.repositoryOutcome).toBe("unchanged");
      expect(restoreWithSideBranch.notification?.message).toMatch(
        /only exists in a chat's worktree/,
      );
      expect(git(["rev-parse", targetBranch])).toBe(main);
    } finally {
      git(["branch", "-D", "kept-from-worktree"]);
    }
  }, 60_000);

  it("removes a chat's worktree when the chat is deleted", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const turn = await harness.streamChat("tc=local-agent/basic-response", {
      chatId,
    });
    expect(turn.event("chat:response:error")).toBeUndefined();
    const workspace = getWorkspaceForChat(chatId)!;
    expect(fs.existsSync(workspace.path)).toBe(true);

    const deleteChat = h.ipcHandlers.get("delete-chat")!;
    // A delete that fails leaves the chat with its worktree, uncommitted
    // edits included.
    fs.writeFileSync(path.join(workspace.path, "draft.txt"), "keep me\n");
    const deleteSpy = vi
      .spyOn(chatJournalCleanup, "deleteChatJournals")
      .mockRejectedValueOnce(new Error("EBUSY: resource busy or locked"));
    try {
      const failed = (await deleteChat(createFakeIpcEvent([]), chatId)) as {
        ok: boolean;
      };
      expect(failed.ok).toBe(false);
    } finally {
      deleteSpy.mockRestore();
    }
    expect(getWorkspaceForChat(chatId)?.status).toBe("active");
    expect(
      fs.readFileSync(path.join(workspace.path, "draft.txt"), "utf8"),
    ).toBe("keep me\n");
    fs.rmSync(path.join(workspace.path, "draft.txt"));

    const result = (await deleteChat(createFakeIpcEvent([]), chatId)) as {
      ok: boolean;
    };
    expect(result.ok).toBe(true);
    expect(getWorkspaceForChat(chatId)).toBeUndefined();
    expect(fs.existsSync(workspace.path)).toBe(false);
    // Nothing of its own was unmerged, so its branch goes too.
    expect(git(["branch", "--list", workspace.branch])).toBe("");
  }, 60_000);

  it("merges a turn that stopped at its step limit", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    await landTurn(
      chatId,
      { "src/step-limit.ts": "export const partial = true;\n" },
      { stepLimitReached: true },
    );
    await waitForMerged(chatId);
    expect(harness.appFileExists("src/step-limit.ts")).toBe(true);
    await discardWorkspace(chatId);
  }, 60_000);

  it("merges past unrelated uncommitted changes in the app's folder, not over them", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    // Dyad itself leaves changes like this in the app's folder.
    fs.appendFileSync(
      path.join(harness.appDir, "index.html"),
      "<!-- local -->\n",
    );
    try {
      await landTurn(chatId, { "src/unrelated.ts": "chat\n" });
      await waitForMerged(chatId);
      expect(harness.readAppFile("src/unrelated.ts")).toBe("chat\n");
      expect(harness.readAppFile("index.html")).toContain("<!-- local -->");
    } finally {
      git(["checkout", "--", "index.html"]);
    }

    // A local change to a file the chat also changed is never overwritten.
    fs.writeFileSync(path.join(harness.appDir, "src/unrelated.ts"), "local\n");
    await landTurn(chatId, { "src/unrelated.ts": "chat again\n" });
    await vi.waitFor(
      () =>
        expect(getWorkspaceForChat(chatId)?.integrationDetail).toMatch(
          /files this chat also changed/,
        ),
      { timeout: 30_000, interval: 50 },
    );
    expect(harness.readAppFile("src/unrelated.ts")).toBe("local\n");
    git(["checkout", "--", "src/unrelated.ts"]);
    workspaceIntegrationQueue.resumePending();
    await waitForMerged(chatId);
    expect(harness.readAppFile("src/unrelated.ts")).toBe("chat again\n");
    await discardWorkspace(chatId);
  }, 60_000);

  it("does not rerun checks that failed on the same files until Retry", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const validate = vi.mocked(validateWorkspace);
    validate.mockResolvedValueOnce({
      passed: false,
      checks: [
        { name: "install", outcome: "passed", summary: "Installed." },
        {
          name: "type-check",
          outcome: "failed",
          summary: "1 type error.",
        },
      ],
    });
    await landTurn(chatId, { "src/broken.ts": "export const broken = 1;\n" });
    await vi.waitFor(
      () =>
        expect(getWorkspaceForChat(chatId)?.integrationStatus).toBe("failed"),
      { timeout: 30_000, interval: 50 },
    );
    const callsAfterFailure = validate.mock.calls.length;

    // A later turn that changes nothing asks again; the same files fail the
    // same way without installing and building again.
    const workspace = getWorkspaceForChat(chatId)!;
    harness.db
      .update(chatWorkspaces)
      .set({ integrationDetail: "before" })
      .where(eq(chatWorkspaces.id, workspace.id))
      .run();
    await landTurn(chatId, {});
    await vi.waitFor(
      () =>
        expect(getWorkspaceForChat(chatId)).toMatchObject({
          integrationStatus: "failed",
          integrationDetail: expect.stringMatching(/type-check/),
        }),
      { timeout: 30_000, interval: 50 },
    );
    expect(validate.mock.calls.length).toBe(callsAfterFailure);

    // Retry checks again (and now passes).
    await chatWorkspaceService.retryIntegration(chatId);
    await waitForMerged(chatId);
    expect(validate.mock.calls.length).toBe(callsAfterFailure + 1);
    await discardWorkspace(chatId);
  }, 60_000);

  it("checks again after a check timed out instead of remembering it", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const validate = vi.mocked(validateWorkspace);
    validate.mockResolvedValueOnce({
      passed: false,
      transientFailure: true,
      checks: [
        { name: "install", outcome: "passed", summary: "Installed." },
        {
          name: "build",
          outcome: "failed",
          summary: "npm run build timed out.",
        },
      ],
    });
    await landTurn(chatId, { "src/slow.ts": "export const slow = 1;\n" });
    await vi.waitFor(
      () =>
        expect(getWorkspaceForChat(chatId)?.integrationStatus).toBe("failed"),
      { timeout: 30_000, interval: 50 },
    );
    const callsAfterTimeout = validate.mock.calls.length;

    // The next request for the same files validates again (and passes).
    await landTurn(chatId, {});
    await waitForMerged(chatId);
    expect(validate.mock.calls.length).toBe(callsAfterTimeout + 1);
    await discardWorkspace(chatId);
  }, 60_000);

  it("brings current settings and transcript backups into a kept worktree", async () => {
    await waitForQuietApp();
    const chatId = buildChatId;
    const workspacePath = getWorkspaceAppPath(getWorkspaceForChat(chatId)!);
    // The Configure panel rewrote the app's environment after the worktree
    // was created, and an earlier compaction kept its transcript backup.
    const later = new Date(Date.now() + 60_000);
    fs.writeFileSync(path.join(harness.appDir, ".env.local"), "KEY=current\n");
    fs.utimesSync(path.join(harness.appDir, ".env.local"), later, later);
    const backup = path.join(
      ".dyad",
      "chats",
      String(chatId),
      "compaction-x.md",
    );
    fs.mkdirSync(path.dirname(path.join(harness.appDir, backup)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(harness.appDir, backup), "transcript\n");

    await landTurn(chatId, {});
    expect(
      fs.readFileSync(path.join(workspacePath, ".env.local"), "utf8"),
    ).toBe("KEY=current\n");
    expect(fs.readFileSync(path.join(workspacePath, backup), "utf8")).toBe(
      "transcript\n",
    );
    // Neither is work to merge.
    expect(git(["status", "--porcelain"], workspacePath)).toBe("");
  }, 60_000);

  it("validates again before landing files that changed while integrating", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    await landTurn(chatId, { "src/validated.ts": "first\n" });
    await waitForMerged(chatId);
    const workspace = getWorkspaceForChat(chatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    // A turn committed after validation while the attempt was saved as
    // "integrating" (for example across a restart).
    fs.writeFileSync(path.join(workspacePath, "src/validated.ts"), "second\n");
    git(["add", "-A"], workspacePath);
    git(
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "Later",
      ],
      workspacePath,
    );
    harness.db
      .update(chatWorkspaces)
      .set({
        integrationStatus: "integrating",
        integrationTargetCommit: git(["rev-parse", targetBranch]),
      })
      .where(eq(chatWorkspaces.id, workspace.id))
      .run();
    const callsBefore = vi.mocked(validateWorkspace).mock.calls.length;
    workspaceIntegrationQueue.resumePending();
    await waitForMerged(chatId);
    expect(vi.mocked(validateWorkspace).mock.calls.length).toBe(
      callsBefore + 1,
    );
    expect(harness.readAppFile("src/validated.ts")).toBe("second\n");
    await discardWorkspace(chatId);
  }, 60_000);

  it("leaves a worktree's .gitignore alone and still ignores .dyad there", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    await landTurn(chatId, {});
    const workspacePath = getWorkspaceAppPath(getWorkspaceForChat(chatId)!);
    const before = fs.readFileSync(
      path.join(workspacePath, ".gitignore"),
      "utf8",
    );
    expect(before).not.toContain(".dyad");
    await ensureDyadGitignored(workspacePath);
    fs.mkdirSync(path.join(workspacePath, ".dyad"), { recursive: true });
    fs.writeFileSync(path.join(workspacePath, ".dyad", "note.md"), "x\n");
    expect(
      fs.readFileSync(path.join(workspacePath, ".gitignore"), "utf8"),
    ).toBe(before);
    expect(git(["status", "--porcelain"], workspacePath)).toBe("");
    await discardWorkspace(chatId);
  }, 60_000);

  it("merges a conflict a turn resolved after the attempt had already failed", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const author = [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
    ];
    await landTurn(chatId, { "src/resolved.ts": "base\n" });
    await waitForMerged(chatId);
    const workspace = getWorkspaceForChat(chatId)!;
    const workspacePath = getWorkspaceAppPath(workspace);
    // Both sides changed the line; the attempt failed with the merge left
    // in progress (for example a lock error while completing it).
    commitInApp({ "src/resolved.ts": "main\n" }, "Main change");
    fs.writeFileSync(path.join(workspacePath, "src/resolved.ts"), "chat\n");
    git(["add", "-A"], workspacePath);
    git([...author, "commit", "-m", "Chat change"], workspacePath);
    expect(() =>
      git([...author, "merge", targetBranch], workspacePath),
    ).toThrow();
    harness.db
      .update(chatWorkspaces)
      .set({ integrationStatus: "failed", integrationDetail: "Lock error" })
      .where(eq(chatWorkspaces.id, workspace.id))
      .run();

    // The user's next turn resolves it.
    const turn = await chatWorkspaceService.prepareTurnWorkspace({
      appId: harness.appId,
      chatId,
      originalAppPath: harness.appDir,
      writable: true,
      allowIsolation: true,
      signal: new AbortController().signal,
    });
    try {
      fs.writeFileSync(path.join(workspacePath, "src/resolved.ts"), "both\n");
      git(["add", "-A"], workspacePath);
      turn.outcome.completed = true;
    } finally {
      await turn.settle();
    }
    await waitForMerged(chatId);
    expect(harness.readAppFile("src/resolved.ts")).toBe("both\n");
    await discardWorkspace(chatId);
  }, 60_000);

  it("commits lockfile changes an install left behind instead of waiting", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const lockfile = harness.readAppFile("pnpm-lock.yaml");
    await landTurn(
      chatId,
      { "src/deps.ts": "export const deps = true;\n" },
      {
        uncommitted: {
          "pnpm-lock.yaml": `${lockfile}\n# normalized by install\n`,
        },
      },
    );
    await waitForMerged(chatId);
    expect(harness.readAppFile("src/deps.ts")).toContain("deps");
    expect(harness.readAppFile("pnpm-lock.yaml")).toContain(
      "# normalized by install",
    );
    // The version is named after the turn, not the dependency-file commit.
    expect(git(["log", "-1", "--format=%s"])).toBe("Hand-made turn");
    await discardWorkspace(chatId);
  }, 60_000);

  it("replaces a lockfile the app folder's install rewrote when the chat changes it", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const lockfile = harness.readAppFile("pnpm-lock.yaml");
    // The main preview's install rewrote it; nothing commits it there.
    fs.writeFileSync(
      path.join(harness.appDir, "pnpm-lock.yaml"),
      `${lockfile}\n# rewritten by the main preview\n`,
    );
    await landTurn(chatId, {
      "src/dep.ts": "export const dep = true;\n",
      "pnpm-lock.yaml": `${lockfile}\n# the chat added a dependency\n`,
    });
    await waitForMerged(chatId);
    expect(harness.readAppFile("pnpm-lock.yaml")).toContain(
      "# the chat added a dependency",
    );
    expect(git(["status", "--porcelain"])).toBe("");
    await discardWorkspace(chatId);
  }, 60_000);

  it("keeps a lockfile the user changed with package.json in the app's folder", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const lockfile = harness.readAppFile("pnpm-lock.yaml");
    const manifest = harness.readAppFile("package.json");
    // The user installed a dependency by hand: both files are edited.
    const userLockfile = `${lockfile}\n# the user added a dependency\n`;
    fs.writeFileSync(path.join(harness.appDir, "pnpm-lock.yaml"), userLockfile);
    fs.writeFileSync(
      path.join(harness.appDir, "package.json"),
      manifest.replace(/\}\s*$/, ',\n  "x-user-edit": true\n}\n'),
    );
    try {
      await landTurn(chatId, {
        "pnpm-lock.yaml": `${lockfile}\n# the chat added a dependency\n`,
      });
      await vi.waitFor(
        () =>
          expect(getWorkspaceForChat(chatId)?.integrationDetail).toMatch(
            /files this chat also changed/,
          ),
        { timeout: 30_000, interval: 50 },
      );
      expect(harness.readAppFile("pnpm-lock.yaml")).toBe(userLockfile);
    } finally {
      git(["checkout", "--", "pnpm-lock.yaml", "package.json"]);
    }
    workspaceIntegrationQueue.resumePending();
    await waitForMerged(chatId);
    await discardWorkspace(chatId);
  }, 60_000);

  it("commits a pnpm-workspace.yaml the preview's install wrote", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    await landTurn(
      chatId,
      { "src/builds.ts": "export const builds = true;\n" },
      {
        uncommitted: {
          "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - esbuild\n",
        },
      },
    );
    await waitForMerged(chatId);
    expect(harness.readAppFile("src/builds.ts")).toContain("builds");
    expect(harness.readAppFile("pnpm-workspace.yaml")).toContain("esbuild");
    await discardWorkspace(chatId);
  }, 60_000);

  it("refreshes a cached test list after a worktree spec reaches the main folder", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const spec = "e2e-tests/from-worktree.spec.ts";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const queryKey = queryKeys.tests.list({ appId: harness.appId });
    const otherAppKey = queryKeys.tests.list({ appId: harness.appId + 1 });
    queryClient.setQueryData(queryKey, { specs: [] });
    queryClient.setQueryData(otherAppKey, { specs: [] });
    const discoverSpecs = vi.fn(async () => ({
      specs: await listSpecFiles(harness.appDir),
    }));
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: discoverSpecs,
    });
    const unsubscribe = observer.subscribe(() => {});
    const sessionId = WindowSessionIdSchema.parse(
      "10000000-0000-4000-8000-000000000099",
    );
    const consumer = new RendererQueryInvalidationConsumer(
      queryClient,
      sessionId,
    );
    const endpoint = {
      id: 98765,
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        if (channel === "window:query-invalidations") {
          consumer.consume(QueryInvalidationBatchSchema.parse(payload));
        }
      },
    };
    // Ignore earlier app activity: this window already cached the list before
    // the chat's background merge. No stream-finished event will refresh it.
    queryInvalidationBus.flush();
    consumer.recover(queryInvalidationBus.currentEpoch(), [], []);
    windowRegistry.register(endpoint, sessionId);
    try {
      expect(discoverSpecs).not.toHaveBeenCalled();
      await landTurn(chatId, {
        [spec]: 'test("merged test", async () => {});\n',
      });
      await waitForMerged(chatId);
      queryInvalidationBus.flush();
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data?.specs).toContain(spec);
      });
      expect(discoverSpecs).toHaveBeenCalledOnce();
      expect(queryClient.getQueryState(otherAppKey)?.isInvalidated).toBe(false);
    } finally {
      windowRegistry.unregister(endpoint.id);
      unsubscribe();
      queryClient.clear();
      await discardWorkspace(chatId);
    }
  }, 60_000);

  it("copies back only media the turn created", async () => {
    await waitForQuietApp();
    const chatId = await createChat();
    const mediaDir = path.join(harness.appDir, ".dyad", "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "kept.png"), "kept");
    const turn = await chatWorkspaceService.prepareTurnWorkspace({
      appId: harness.appId,
      chatId,
      originalAppPath: harness.appDir,
      writable: true,
      allowIsolation: true,
      signal: new AbortController().signal,
    });
    try {
      expect(
        fs.existsSync(path.join(turn.appPath, ".dyad", "media", "kept.png")),
      ).toBe(true);
      // The user deletes it from the media library while the turn runs.
      fs.rmSync(path.join(mediaDir, "kept.png"));
      fs.writeFileSync(
        path.join(turn.appPath, ".dyad", "media", "generated.png"),
        "new",
      );
      turn.outcome.completed = true;
    } finally {
      await turn.settle();
    }
    expect(fs.existsSync(path.join(mediaDir, "kept.png"))).toBe(false);
    expect(fs.existsSync(path.join(mediaDir, "generated.png"))).toBe(true);
    await discardWorkspace(chatId);
  }, 60_000);
});

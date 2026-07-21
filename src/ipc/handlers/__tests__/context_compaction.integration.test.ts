// Migrated from e2e-tests/context_compaction.spec.ts, then converted from the
// node chat-flow harness to the HYBRID harness (real <ChatPanel> over the real
// IPC stack). The describe/it names are kept identical to the node version on
// purpose: the existing __snapshots__ transcripts then act as a cross-harness
// equivalence oracle for the UI-driven turns.
//
// Local-agent context compaction: a turn that reports huge token usage marks
// the chat for compaction; the next turn performs it (an LLM-generated summary
// replaces the old history) before answering. A second fixture triggers
// compaction mid-turn and still finishes the same turn.
//
// The e2e asserted the compaction indicator/summary through the UI; the hybrid
// conversion restores that surface (the <dyad-compaction> "Conversation
// compacted" card rendered in the messages list) while keeping every
// db-visible assertion (the <dyad-compaction> marker, the "Key Decisions Made"
// summary, the follow-up response text) plus the masked [dump] transcript sent
// to the LLM afterwards. Note the local-agent chat handler returns undefined
// (not the chatId), so success is asserted via the stored messages / absence
// of a stream error. Dyad Engine calls are routed to the harness fake server
// via `engine: true`.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { ipc } from "@/ipc/types";
import { chats, messages } from "@/db/schema";
import {
  getCurrentCommitHash,
  gitAddAll,
  gitCheckout,
  gitCommit,
  gitCurrentBranch,
  gitLog,
} from "@/ipc/utils/git_utils";

describe("context compaction (integration)", () => {
  let harness: HybridChatHarness;

  const errorEvents = () =>
    harness.bridge.sentEvents.filter(
      (e) => e.channel === "chat:response:error",
    );

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      // The e2e picks a non-OpenAI model for local agent mode (OpenAI models
      // go to the responses API); Claude Opus 4.5 comes from the fake catalog.
      selectedModel: { provider: "anthropic", name: "claude-opus-4-5" },
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: {
          auto: {
            apiKey: { value: "testdyadkey", encryptionType: "plaintext" },
          },
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  const loadChatMessages = (chatId: number) =>
    harness.db.query.messages.findMany({
      where: (messages, { eq }) => eq(messages.chatId, chatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });

  /** Type + send one turn through the real UI and await ITS stream end. */
  const sendTurn = async (text: string, chatId: number) => {
    const { send } = await harness.typeInChat(text, { chatId });
    // Baseline-aware: snapshot the current end-count BEFORE starting the turn
    // so turn 2+ doesn't resolve on a stale chat:response:end.
    const turnEnd = harness.waitForNextStreamEnd(chatId);
    send();
    await turnEnd;
  };

  it("compaction triggers and shows summary", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // First message reports ~200k tokens, exceeding the compaction threshold
    // and marking the chat for compaction on the next message.
    await sendTurn("tc=local-agent/compaction-trigger", harness.chatId);
    expect(errorEvents()).toHaveLength(0);
    // The fixture's response renders in the messages list.
    await harness.waitForRenderedText(/I've completed the initial analysis/);
    // ...and is persisted (original node assertion).
    const firstMessages = await loadChatMessages(harness.chatId);
    expect(
      firstMessages.some((m) =>
        m.content.includes("I've completed the initial analysis"),
      ),
    ).toBe(true);

    // Second message: the handler performs the pending compaction (summary
    // replaces old history) and then processes the message normally.
    await sendTurn("tc=local-agent/simple-response", harness.chatId);
    expect(errorEvents()).toHaveLength(0);

    // The compaction card renders in the DOM — the surface the e2e asserted:
    // the "Conversation compacted" indicator with the summary underneath.
    await harness.waitForRenderedText("Conversation compacted");
    await harness.waitForRenderedText(/Key Decisions Made/);
    await harness.waitForRenderedText(
      /simple response from the Basic Agent mode/,
    );

    const secondMessages = await loadChatMessages(harness.chatId);
    const contents = secondMessages.map((m) => m.content).join("\n");
    expect(contents).toContain(
      '<dyad-compaction title="Conversation compacted"',
    );
    expect(contents).toContain("Key Decisions Made");
    expect(contents).toContain(
      "Hello! I understand your request. This is a simple response from the Basic Agent mode.",
    );

    // The summary is inserted after the prompt in identity order but backdated
    // before it for display/model ordering. Restoring to before that prompt
    // must not carry the summary (which already includes the removed turn) into
    // the forked chat.
    const targetPrompt = secondMessages.find(
      (message) =>
        message.role === "user" &&
        message.content === "tc=local-agent/simple-response",
    );
    const compactionSummary = secondMessages.find(
      (message) => message.isCompactionSummary,
    );
    expect(targetPrompt).toBeDefined();
    expect(compactionSummary).toBeDefined();
    expect(compactionSummary!.id).toBeGreaterThan(targetPrompt!.id);
    expect(compactionSummary!.createdAt.getTime()).toBeLessThan(
      targetPrompt!.createdAt.getTime(),
    );

    const restoreResult = await ipc.version.restoreToMessageVersion({
      appId: harness.appId,
      chatId: harness.chatId,
      messageId: targetPrompt!.id,
      restoreCodebase: false,
    });
    expect(restoreResult).toHaveProperty("createdChatId");
    const restoredMessages = await loadChatMessages(
      restoreResult.createdChatId ?? -1,
    );
    expect(
      restoredMessages.some(
        (message) =>
          message.content === "tc=local-agent/simple-response" ||
          message.isCompactionSummary,
      ),
    ).toBe(false);

    // The transcript sent to the LLM afterwards contains the compacted
    // summary instead of the original history.
    await sendTurn("[dump] hi", harness.chatId);
    const dump = harness.getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("Key Decisions Made");
    expect(dump.text).toContain(
      "Conversation was compacted to save context space.",
    );
    expect(dump.text).not.toContain("tc=local-agent/compaction-trigger");
    expect(dump.text).toMatchSnapshot("compaction-post-summary-transcript");

    const postCompactionMessages = await loadChatMessages(harness.chatId);
    const laterPrompt = postCompactionMessages.find(
      (message) => message.role === "user" && message.content === "[dump] hi",
    );
    expect(laterPrompt).toBeDefined();

    const laterRestoreResult = await ipc.version.restoreToMessageVersion({
      appId: harness.appId,
      chatId: harness.chatId,
      messageId: laterPrompt!.id,
      restoreCodebase: false,
    });
    expect(laterRestoreResult).toHaveProperty("createdChatId");
    const laterRestoredMessages = await loadChatMessages(
      laterRestoreResult.createdChatId ?? -1,
    );
    const copiedTrigger = laterRestoredMessages.find(
      (message) =>
        message.role === "user" &&
        message.content === "tc=local-agent/simple-response",
    );
    const copiedSummary = laterRestoredMessages.find(
      (message) => message.isCompactionSummary,
    );
    expect(copiedTrigger).toBeDefined();
    expect(copiedSummary).toBeDefined();
    expect(copiedSummary!.id).toBeGreaterThan(copiedTrigger!.id);
    expect(copiedSummary!.createdAt.getTime()).toBeLessThan(
      copiedTrigger!.createdAt.getTime(),
    );
  }, 60_000);

  it("compaction can run mid-turn", async () => {
    // Fresh chat, mirroring the e2e's separate test app.
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId, chatMode: "local-agent" })
      .returning();
    const chatId = chatRow.id;

    harness.mount({ chatId });
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    await sendTurn("hi", chatId);
    expect(errorEvents()).toHaveLength(0);

    // This fixture emits a tool call with high token usage in step 1, then a
    // final text response in step 2 of the same user turn.
    await sendTurn("tc=local-agent/compaction-mid-turn", chatId);
    expect(errorEvents()).toHaveLength(0);

    // The compaction card renders mid-conversation, and the agent still
    // finishes the same turn in the DOM.
    await harness.waitForRenderedText("Conversation compacted");
    await harness.waitForRenderedText(/END OF COMPACTED TURN/);

    const messages = await loadChatMessages(chatId);
    const contents = messages.map((m) => m.content).join("\n");
    expect(contents).toContain(
      '<dyad-compaction title="Conversation compacted"',
    );
    expect(contents).toContain("Key Decisions Made");
    // The agent still completes the response in the same turn.
    expect(contents).toContain("END OF COMPACTED TURN.");

    await sendTurn("[dump] hi", chatId);
    const dump = harness.getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("Key Decisions Made");
    expect(dump.text).toContain("END OF COMPACTED TURN.");
    expect(dump.text).toMatchSnapshot("compaction-mid-turn-transcript");
  }, 60_000);

  it("restore to the first message forks an empty chat", async () => {
    const initialCommitHash = await getCurrentCommitHash({
      path: harness.appDir,
    });
    const [chatRow] = await harness.db
      .insert(chats)
      .values({
        appId: harness.appId,
        chatMode: "local-agent",
        initialCommitHash,
      })
      .returning();
    const [firstMessage] = await harness.db
      .insert(messages)
      .values({
        chatId: chatRow.id,
        role: "user",
        content: "First prompt",
      })
      .returning();

    const result = await ipc.version.restoreToMessageVersion({
      appId: harness.appId,
      chatId: chatRow.id,
      messageId: firstMessage.id,
      restoreCodebase: true,
    });

    expect(result).toHaveProperty("createdChatId");
    const createdChatId = result.createdChatId ?? -1;
    await expect(loadChatMessages(createdChatId)).resolves.toEqual([]);
    await expect(
      harness.db.query.chats.findFirst({
        where: (chats, { eq }) => eq(chats.id, createdChatId),
      }),
    ).resolves.toMatchObject({
      appId: harness.appId,
      initialCommitHash,
    });
  });

  it("restore to message uses the target branch while previewing detached history", async () => {
    const targetBranchName = await gitCurrentBranch({
      path: harness.appDir,
    });
    expect(targetBranchName).toBeTruthy();

    const initialCommitHash = await getCurrentCommitHash({
      path: harness.appDir,
      ref: targetBranchName!,
    });
    const [chatRow] = await harness.db
      .insert(chats)
      .values({
        appId: harness.appId,
        chatMode: "local-agent",
        initialCommitHash,
      })
      .returning();
    const [firstMessage] = await harness.db
      .insert(messages)
      .values({
        chatId: chatRow.id,
        role: "user",
        content: "First prompt from detached preview",
      })
      .returning();

    await gitCheckout({ path: harness.appDir, ref: initialCommitHash });
    expect(await gitCurrentBranch({ path: harness.appDir })).toBeNull();

    try {
      const result = await ipc.version.restoreToMessageVersion({
        appId: harness.appId,
        chatId: chatRow.id,
        messageId: firstMessage.id,
        restoreCodebase: true,
        targetBranchName: targetBranchName!,
      });

      expect(result).toHaveProperty("createdChatId");
      expect(result.repositoryOutcome).toBe("target-applied");
      await expect(gitCurrentBranch({ path: harness.appDir })).resolves.toBe(
        targetBranchName,
      );
    } finally {
      await gitCheckout({
        path: harness.appDir,
        ref: targetBranchName!,
      }).catch(() => {});
    }
  });

  it("anchors a fork-only chat to the detached preview commit", async () => {
    const targetBranchName = await gitCurrentBranch({ path: harness.appDir });
    expect(targetBranchName).toBeTruthy();
    const chatInitialCommitHash = await getCurrentCommitHash({
      path: harness.appDir,
    });
    const previewFile = path.join(harness.appDir, "detached-preview.txt");
    await fs.promises.writeFile(previewFile, "preview commit\n");
    await gitAddAll({ path: harness.appDir });
    const previewCommitHash = await gitCommit({
      path: harness.appDir,
      message: "Create detached fork preview fixture",
    });
    const [chatRow] = await harness.db
      .insert(chats)
      .values({
        appId: harness.appId,
        chatMode: "local-agent",
        initialCommitHash: chatInitialCommitHash,
      })
      .returning();
    const [firstMessage] = await harness.db
      .insert(messages)
      .values({
        chatId: chatRow.id,
        role: "user",
        content: "Fork from this detached preview",
      })
      .returning();

    await gitCheckout({ path: harness.appDir, ref: previewCommitHash });
    try {
      const result = await ipc.version.restoreToMessageVersion({
        appId: harness.appId,
        chatId: chatRow.id,
        messageId: firstMessage.id,
        restoreCodebase: false,
      });

      expect(result).toHaveProperty("createdChatId");
      expect(result.repositoryOutcome).toBe("unchanged");
      const forkedChat = await harness.db.query.chats.findFirst({
        where: (chat, { eq }) => eq(chat.id, result.createdChatId ?? -1),
      });
      expect(forkedChat?.initialCommitHash).toBe(previewCommitHash);
    } finally {
      await gitCheckout({
        path: harness.appDir,
        ref: targetBranchName!,
      }).catch(() => {});
    }
  });

  it("preflights detached restores and checkpoints dirty preview writes before switching branches", async () => {
    const targetBranchName = await gitCurrentBranch({ path: harness.appDir });
    expect(targetBranchName).toBeTruthy();
    const conflictFile = path.join(harness.appDir, "detached-conflict.txt");
    await fs.promises.writeFile(conflictFile, "restore target\n");
    await gitAddAll({ path: harness.appDir });
    const restoreTargetHash = await gitCommit({
      path: harness.appDir,
      message: "Create detached restore target fixture",
    });
    await fs.promises.writeFile(conflictFile, "live branch\n");
    await gitAddAll({ path: harness.appDir });
    await gitCommit({
      path: harness.appDir,
      message: "Advance detached restore branch fixture",
    });

    const [restoreChat, backgroundChat] = await harness.db
      .insert(chats)
      .values([
        {
          appId: harness.appId,
          chatMode: "local-agent",
          initialCommitHash: restoreTargetHash,
        },
        {
          appId: harness.appId,
          chatMode: "local-agent",
          initialCommitHash: restoreTargetHash,
        },
      ])
      .returning();
    const [restoreMessage] = await harness.db
      .insert(messages)
      .values({
        chatId: restoreChat.id,
        role: "user",
        content: "Restore while detached and dirty",
      })
      .returning();

    await gitCheckout({ path: harness.appDir, ref: restoreTargetHash });
    let backgroundSettled = false;
    const backgroundStream = harness
      .streamChat("tc=local-agent/cancel-todos", {
        chatId: backgroundChat.id,
      })
      .finally(() => {
        backgroundSettled = true;
      });

    try {
      await vi.waitFor(
        async () => {
          const activeMessages = await harness.db.query.messages.findMany({
            where: (message, { and, eq }) =>
              and(
                eq(message.chatId, backgroundChat.id),
                eq(message.role, "assistant"),
              ),
          });
          expect(activeMessages.length).toBeGreaterThan(0);
        },
        { timeout: 20_000 },
      );
      await fs.promises.writeFile(conflictFile, "interrupted generation\n");

      await expect(
        ipc.version.restoreToMessageVersion({
          appId: harness.appId,
          chatId: restoreChat.id,
          messageId: restoreMessage.id,
          restoreCodebase: true,
        }),
      ).rejects.toThrow("Cannot restore while viewing a historical version");
      expect(backgroundSettled).toBe(false);

      const result = await ipc.version.restoreToMessageVersion({
        appId: harness.appId,
        chatId: restoreChat.id,
        messageId: restoreMessage.id,
        restoreCodebase: true,
        targetBranchName: targetBranchName!,
      });
      await backgroundStream;

      expect(result).toHaveProperty("createdChatId");
      await expect(gitCurrentBranch({ path: harness.appDir })).resolves.toBe(
        targetBranchName,
      );
      await expect(fs.promises.readFile(conflictFile, "utf8")).resolves.toBe(
        "restore target\n",
      );
      const versions = await gitLog({ path: harness.appDir });
      expect(
        versions.some((version) =>
          version.commit.message.includes("Saved partial changes"),
        ),
      ).toBe(true);
    } finally {
      if (!backgroundSettled) {
        await ipc.chat.cancelStream(backgroundChat.id).catch(() => {});
        await backgroundStream.catch(() => {});
      }
      await gitCheckout({
        path: harness.appDir,
        ref: targetBranchName!,
      }).catch(() => {});
    }
  }, 60_000);
});

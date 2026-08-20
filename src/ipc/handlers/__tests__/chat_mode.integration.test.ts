// Migrated from e2e-tests/chat_mode.spec.ts, then converted from the node
// chat-flow harness to the HYBRID harness (real <ChatPanel> over the real IPC
// stack). The describe/it names are kept identical to the node version on
// purpose: the existing __snapshots__ entries then act as a cross-harness
// equivalence oracle — proving the UI-driven chat:stream sends byte-for-byte the
// same LLM payload the node harness did.
//
// Behavior tests ported:
//   - "default build mode": the LLM payload in build mode includes the
//     codebase-priming user turn; the prompt is sent by clicking the real Send
//     button, and the dump is asserted via getServerDump.
//   - "ask mode": the chat mode is switched to "ask" through the REAL
//     ChatModeSelector dropdown (it lives in ChatInput -> ChatInputControls);
//     the payload then omits the codebase-priming user turn and nothing is
//     committed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

import { screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { chats, messages } from "@/db/schema";
import { readSettings, writeSettings } from "@/main/settings";
import { FREE_AGENT_QUOTA_LIMIT } from "@/lib/free_agent_quota_limit";

function errorEvents(harness: HybridChatHarness) {
  return harness.bridge.sentEvents.filter(
    (e) => e.channel === "chat:response:error",
  );
}

describe("chat mode (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("default build mode sends codebase context and applies changes", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const { send } = await harness.typeInChat("[dump] hi");
    send();

    await waitFor(() => expect(screen.getByText("[dump] hi")).toBeTruthy(), {
      timeout: 15_000,
    });
    await harness.waitForStreamEnd(harness.chatId);
    expect(errorEvents(harness)).toHaveLength(0);

    const dump = harness.getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("message: [[SYSTEM_MESSAGE]]");
    // Build mode primes the model with the codebase as a user turn.
    expect(dump.text).toContain("This is my codebase.");
    expect(dump.text.trimEnd()).toMatch(/role: user\nmessage: \[dump\] hi$/);
    expect(dump.text).toMatchSnapshot("chat-mode-build-all-messages");

    // Equivalent of snapshotMessages: user prompt + assistant response
    // containing the (path-masked in UI) dump marker.
    const messages = await harness.db.query.messages.findMany();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("[dump] hi");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("[[dyad-dump-path=");
    const latchedChat = await harness.db.query.chats.findFirst({
      where: (chats, { eq }) => eq(chats.id, harness.chatId),
    });
    expect(latchedChat?.chatMode).toBe("build");
  }, 60_000);

  it("ask mode omits codebase context and does not apply changes", async () => {
    // The e2e selected ask mode via the chat-mode selector; mirror that by
    // creating a fresh chat and driving the REAL selector to "ask" (it persists
    // chatMode onto the chat row via ipc.chat.updateChat).
    const askChatId = await harness.createChat();
    harness.mount({ chatId: askChatId });
    await waitFor(
      () => expect(screen.getByTestId("chat-input-container")).toBeTruthy(),
      { timeout: 15_000 },
    );

    // Drive the REAL Base UI Select to "ask" (persists chatMode onto the chat
    // row). The harness helper encapsulates the happy-dom choreography (focus +
    // ArrowDown to open, pointer + Enter on the option to commit).
    await harness.selectChatMode("ask");

    const { send } = await harness.typeInChat("[dump] hi", {
      chatId: askChatId,
    });
    send();

    await waitFor(() => expect(screen.getByText("[dump] hi")).toBeTruthy(), {
      timeout: 15_000,
    });
    await harness.waitForStreamEnd(askChatId);
    expect(errorEvents(harness)).toHaveLength(0);

    const dump = harness.getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("message: [[SYSTEM_MESSAGE]]");
    // Ask mode does NOT include the codebase-priming user turn.
    expect(dump.text).not.toContain("This is my codebase.");
    expect(dump.text.trimEnd()).toMatch(/role: user\nmessage: \[dump\] hi$/);
    expect(dump.text).toMatchSnapshot("chat-mode-ask-all-messages");

    // The response is recorded on the ask chat but nothing is committed.
    const dbMessages = await harness.db.query.messages.findMany();
    const askChatMessages = dbMessages.filter((m) => m.chatId === askChatId);
    expect(askChatMessages).toHaveLength(2);
    expect(askChatMessages[0].role).toBe("user");
    expect(askChatMessages[0].content).toBe("[dump] hi");
    const assistant = askChatMessages[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.commitHash).toBeNull();
    // No git commit was produced by either turn. A bare "[dump] hi" reply is
    // only the dump-path marker (no dyad-write), so build mode above committed
    // nothing either — only the fixture init commit exists.
    expect(harness.gitLog()).toHaveLength(1);
  }, 60_000);

  it("repairs a null mode when an accepted first turn is replayed", async () => {
    const replayChatId = await harness.createChat();
    const userInputRequestId = "accepted-first-turn";
    await harness.db.insert(messages).values({
      chatId: replayChatId,
      role: "user",
      content: "already accepted",
      userInputRequestId,
    });

    const result = await harness.streamChat("already accepted", {
      chatId: replayChatId,
      requestedChatMode: "ask",
      userInputRequestId,
    });

    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(result.eventsFor("chat:response:end")).toHaveLength(1);
    const repairedChat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, replayChatId),
    });
    expect(repairedChat?.chatMode).toBe("ask");
    const replayMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, replayChatId),
    });
    expect(replayMessages).toHaveLength(1);
  }, 60_000);

  it("honors a requested per-turn mode without replacing the stored mode", async () => {
    const overrideChatId = await harness.createChat();
    await harness.db
      .update(chats)
      .set({ chatMode: "build" })
      .where(eq(chats.id, overrideChatId));

    const result = await harness.streamChat("[dump] per-turn ask", {
      chatId: overrideChatId,
      requestedChatMode: "ask",
      userInputRequestId: "per-turn-ask",
    });

    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    expect(harness.getServerDump({ type: "all-messages" }).text).not.toContain(
      "This is my codebase.",
    );
    const unchangedChat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, overrideChatId),
    });
    expect(unchangedChat?.chatMode).toBe("build");
  }, 60_000);

  it("uses the stored winner after accepting an implicit turn", async () => {
    const originalSettings = readSettings();
    const arbitrationChatId = await harness.createChat();
    await harness.db
      .update(chats)
      .set({ chatMode: "build" })
      .where(eq(chats.id, arbitrationChatId));
    writeSettings({
      selectedChatMode: "ask",
      defaultChatMode: "ask",
    });

    try {
      const result = await harness.streamChat("[dump] authoritative build", {
        chatId: arbitrationChatId,
        requestedChatMode: null,
        userInputRequestId: "implicit-authoritative-build",
      });

      expect(result.eventsFor("chat:response:error")).toHaveLength(0);
      expect(harness.getServerDump({ type: "all-messages" }).text).toContain(
        "This is my codebase.",
      );
      const unchangedChat = await harness.db.query.chats.findFirst({
        where: eq(chats.id, arbitrationChatId),
      });
      expect(unchangedChat?.chatMode).toBe("build");
    } finally {
      writeSettings(originalSettings);
    }
  }, 60_000);

  it("rejects exhausted Basic Agent quota before accepting the turn", async () => {
    const originalSettings = readSettings();
    const quotaChatId = await harness.createChat();
    await harness.db
      .update(chats)
      .set({ chatMode: "local-agent" })
      .where(eq(chats.id, quotaChatId));
    await harness.db.insert(messages).values(
      Array.from({ length: FREE_AGENT_QUOTA_LIMIT }, (_, index) => ({
        chatId: quotaChatId,
        role: "user" as const,
        content: `quota message ${index + 1}`,
        usingFreeAgentModeQuota: true,
        ...(index === 0
          ? { userInputRequestId: "accepted-before-exhaustion" }
          : {}),
      })),
    );
    writeSettings({
      enableDyadPro: false,
      selectedChatMode: "local-agent",
      defaultChatMode: "local-agent",
    });

    try {
      const mediaDir = path.join(harness.appDir, ".dyad", "media");
      const mediaFilesBefore = await fs
        .readdir(mediaDir)
        .catch((): string[] => []);
      const result = await harness.streamChat("must not be accepted", {
        chatId: quotaChatId,
        requestedChatMode: "local-agent",
        userInputRequestId: "exhausted-basic-agent",
        attachments: [
          {
            name: "rejected-quota-attachment.txt",
            type: "text/plain",
            data: "data:text/plain;base64,bXVzdCBub3QgYmUgcGVyc2lzdGVk",
            attachmentType: "chat-context",
          },
        ],
      });

      const errorEvents = result.eventsFor("chat:response:error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].payload).toMatchObject({
        error: expect.stringContaining("FREE_AGENT_QUOTA_EXCEEDED"),
      });
      expect(
        result
          .eventsFor("chat:response:chunk")
          .some(({ payload }) =>
            JSON.stringify(payload).includes("acceptedUserInputRequestId"),
          ),
      ).toBe(false);

      const persistedMessages = await harness.db.query.messages.findMany({
        where: eq(messages.chatId, quotaChatId),
      });
      expect(persistedMessages).toHaveLength(FREE_AGENT_QUOTA_LIMIT);
      expect(
        persistedMessages.some(
          ({ content }) => content === "must not be accepted",
        ),
      ).toBe(false);
      expect(
        persistedMessages.some(
          ({ role, content }) => role === "assistant" && content === "",
        ),
      ).toBe(false);
      expect(await fs.readdir(mediaDir).catch((): string[] => [])).toEqual(
        mediaFilesBefore,
      );

      const replay = await harness.streamChat("quota message 1", {
        chatId: quotaChatId,
        requestedChatMode: "local-agent",
        userInputRequestId: "accepted-before-exhaustion",
      });
      expect(replay.eventsFor("chat:response:error")).toHaveLength(0);
      expect(replay.eventsFor("chat:response:end")).toHaveLength(1);
      const messagesAfterReplay = await harness.db.query.messages.findMany({
        where: eq(messages.chatId, quotaChatId),
      });
      expect(messagesAfterReplay).toHaveLength(FREE_AGENT_QUOTA_LIMIT);
    } finally {
      writeSettings(originalSettings);
    }
  }, 60_000);

  it("atomically reserves the final Basic Agent quota slot across chats", async () => {
    const originalSettings = readSettings();
    await harness.db
      .update(messages)
      .set({ usingFreeAgentModeQuota: false })
      .where(eq(messages.usingFreeAgentModeQuota, true));

    const seedChatId = await harness.createChat();
    const firstChatId = await harness.createChat();
    const secondChatId = await harness.createChat();
    await harness.db
      .update(chats)
      .set({ chatMode: "local-agent" })
      .where(eq(chats.id, firstChatId));
    await harness.db
      .update(chats)
      .set({ chatMode: "local-agent" })
      .where(eq(chats.id, secondChatId));
    await harness.db.insert(messages).values(
      Array.from({ length: FREE_AGENT_QUOTA_LIMIT - 1 }, (_, index) => ({
        chatId: seedChatId,
        role: "user" as const,
        content: `reserved quota message ${index + 1}`,
        usingFreeAgentModeQuota: true,
      })),
    );
    writeSettings({
      enableDyadPro: false,
      selectedChatMode: "local-agent",
      defaultChatMode: "local-agent",
    });

    try {
      const results = await Promise.all([
        harness.streamChat("tc=local-agent/simple-response first contender", {
          chatId: firstChatId,
          requestedChatMode: "local-agent",
          userInputRequestId: "first-quota-contender",
        }),
        harness.streamChat("tc=local-agent/simple-response second contender", {
          chatId: secondChatId,
          requestedChatMode: "local-agent",
          userInputRequestId: "second-quota-contender",
        }),
      ]);

      expect(
        results.filter(
          (result) => result.eventsFor("chat:response:error").length === 1,
        ),
      ).toHaveLength(1);
      expect(
        results.filter(
          (result) => result.eventsFor("chat:response:end").length === 1,
        ),
      ).toHaveLength(1);

      const quotaMessages = await harness.db.query.messages.findMany({
        where: eq(messages.usingFreeAgentModeQuota, true),
      });
      expect(quotaMessages).toHaveLength(FREE_AGENT_QUOTA_LIMIT);
      expect(
        quotaMessages.filter(({ content }) => content.includes("contender")),
      ).toHaveLength(1);
    } finally {
      await harness.db
        .update(messages)
        .set({ usingFreeAgentModeQuota: false })
        .where(eq(messages.usingFreeAgentModeQuota, true));
      writeSettings(originalSettings);
    }
  }, 60_000);

  it("lets main resolve an implicit Google-only first turn", async () => {
    writeSettings({
      enableDyadPro: false,
      providerSettings: {
        google: { apiKey: { value: "google-key" } },
      },
      selectedChatMode: "local-agent",
      defaultChatMode: undefined,
    });
    const implicitChatId = await harness.createChat();

    const result = await harness.streamChat("[dump] google implicit", {
      chatId: implicitChatId,
      userInputRequestId: "google-implicit",
    });

    expect(result.eventsFor("chat:response:error")).toHaveLength(0);
    const latchedChat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, implicitChatId),
    });
    expect(latchedChat?.chatMode).toBe("build");
  }, 60_000);
});

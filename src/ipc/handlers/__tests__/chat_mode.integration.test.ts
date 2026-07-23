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

import { screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { chats, messages } from "@/db/schema";
import type { ChatStreamChunkPayload } from "@/chat_stream/protocol";
import { writeSettings } from "@/main/settings";

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

  it("uses the winning latch for concurrent first turns", async () => {
    const concurrentChatId = await harness.createChat();

    const results = await Promise.all([
      harness.streamChat("[dump] first", {
        chatId: concurrentChatId,
        requestedChatMode: "build",
        userInputRequestId: "concurrent-build",
      }),
      harness.streamChat("[dump] second", {
        chatId: concurrentChatId,
        requestedChatMode: "ask",
        userInputRequestId: "concurrent-ask",
      }),
    ]);

    const persistedChat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, concurrentChatId),
    });
    expect(persistedChat?.chatMode).not.toBeNull();

    const effectiveModes = results.flatMap((result) =>
      result
        .eventsFor("chat:response:chunk")
        .map((event) => event.payload as ChatStreamChunkPayload)
        .map((payload) => payload.effectiveChatMode)
        .filter((mode) => mode !== undefined),
    );
    expect(effectiveModes).toHaveLength(2);
    expect(new Set(effectiveModes)).toEqual(new Set([persistedChat?.chatMode]));
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

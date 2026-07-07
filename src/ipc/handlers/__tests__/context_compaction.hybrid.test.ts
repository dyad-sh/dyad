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
// of a stream error. DYAD_ENGINE_URL is captured at app-module import, so the
// engine server starts in the hoisted block (before any app import).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const engineServer = await vi.hoisted(async () => {
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const engineServer = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
  return engineServer;
});

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("context compaction (integration)", () => {
  let harness: HybridChatHarness;

  const errorEvents = () =>
    harness.bridge.sentEvents.filter(
      (e) => e.channel === "chat:response:error",
    );

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
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
    await engineServer.close();
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
    // The fixture's response renders in the messages list... (getAllByText:
    // the same text can legitimately appear more than once around stream end,
    // e.g. streamed + persisted renderings.)
    await waitFor(
      () =>
        expect(
          screen.getAllByText(/I've completed the initial analysis/).length,
        ).toBeGreaterThan(0),
      { timeout: 20_000 },
    );
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
    await waitFor(
      () => {
        expect(
          screen.getAllByText("Conversation compacted").length,
        ).toBeGreaterThan(0);
        expect(
          screen.getAllByText(/Key Decisions Made/).length,
        ).toBeGreaterThan(0);
      },
      { timeout: 20_000 },
    );
    await waitFor(
      () =>
        expect(
          screen.getAllByText(/simple response from the Basic Agent mode/)
            .length,
        ).toBeGreaterThan(0),
      { timeout: 20_000 },
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
  }, 60_000);

  it("compaction can run mid-turn", async () => {
    // Fresh chat, mirroring the e2e's separate test app.
    const { chats } = await import("@/db/schema");
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
    await waitFor(
      () => {
        expect(
          screen.getAllByText("Conversation compacted").length,
        ).toBeGreaterThan(0);
        expect(
          screen.getAllByText(/END OF COMPACTED TURN/).length,
        ).toBeGreaterThan(0);
      },
      { timeout: 20_000 },
    );

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
});

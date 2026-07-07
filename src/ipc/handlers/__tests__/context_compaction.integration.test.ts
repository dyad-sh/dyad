// @vitest-environment node
//
// Migrated from e2e-tests/context_compaction.spec.ts.
//
// Local-agent context compaction: a turn that reports huge token usage marks
// the chat for compaction; the next turn performs it (an LLM-generated summary
// replaces the old history) before answering. A second fixture triggers
// compaction mid-turn and still finishes the same turn.
//
// The e2e asserted the compaction indicator/summary through the UI; here we
// assert the db-visible equivalents (the <dyad-compaction> marker, the
// "Key Decisions Made" summary, the follow-up response text) plus the masked
// [dump] transcript sent to the LLM afterwards. Note the local-agent chat
// handler returns undefined (not the chatId), so success is asserted via the
// stored messages / absence of a stream error.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import type { ChatFlowHarness } from "@/testing/chat_flow_harness";
import type { FakeLlmServerHandle } from "../../../../testing/fake-llm-server/index";

describe("context compaction (integration)", () => {
  let harness: ChatFlowHarness;
  let engine: FakeLlmServerHandle;

  const localAgent = { requestedChatMode: "local-agent" as const };

  beforeAll(async () => {
    const { startFakeLlmServer } =
      await import("../../../../testing/fake-llm-server/index");
    engine = await startFakeLlmServer();
    process.env.DYAD_ENGINE_URL = `${engine.url}/engine/v1`;

    const { setupChatFlowHarness } =
      await import("@/testing/chat_flow_harness");
    harness = await setupChatFlowHarness({
      electronMock: h,
      // The e2e picks a non-OpenAI model for local agent mode (OpenAI models
      // go to the responses API); Claude Opus 4.5 comes from the fake catalog.
      selectedModel: { provider: "anthropic", name: "claude-opus-4-5" },
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: {
          auto: {
            apiKey: { value: "testdyadkey", encryptionType: "plaintext" },
          },
        },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await engine?.close();
  });

  const loadChatMessages = (chatId: number) =>
    harness.db.query.messages.findMany({
      where: (messages, { eq }) => eq(messages.chatId, chatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });

  it("compaction triggers and shows summary", async () => {
    // First message reports ~200k tokens, exceeding the compaction threshold
    // and marking the chat for compaction on the next message.
    const first = await harness.streamChat(
      "tc=local-agent/compaction-trigger",
      localAgent,
    );
    expect(first.event("chat:response:error")).toBeUndefined();
    expect(
      first.messages.some((m) =>
        m.content.includes("I've completed the initial analysis"),
      ),
    ).toBe(true);

    // Second message: the handler performs the pending compaction (summary
    // replaces old history) and then processes the message normally.
    const second = await harness.streamChat(
      "tc=local-agent/simple-response",
      localAgent,
    );
    expect(second.event("chat:response:error")).toBeUndefined();

    const contents = second.messages.map((m) => m.content).join("\n");
    expect(contents).toContain(
      '<dyad-compaction title="Conversation compacted"',
    );
    expect(contents).toContain("Key Decisions Made");
    expect(contents).toContain(
      "Hello! I understand your request. This is a simple response from the Basic Agent mode.",
    );

    // The transcript sent to the LLM afterwards contains the compacted
    // summary instead of the original history.
    await harness.streamChat("[dump] hi", localAgent);
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

    const first = await harness.streamChat("hi", { ...localAgent, chatId });
    expect(first.event("chat:response:error")).toBeUndefined();

    // This fixture emits a tool call with high token usage in step 1, then a
    // final text response in step 2 of the same user turn.
    const second = await harness.streamChat(
      "tc=local-agent/compaction-mid-turn",
      { ...localAgent, chatId },
    );
    expect(second.event("chat:response:error")).toBeUndefined();

    const messages = await loadChatMessages(chatId);
    const contents = messages.map((m) => m.content).join("\n");
    expect(contents).toContain(
      '<dyad-compaction title="Conversation compacted"',
    );
    expect(contents).toContain("Key Decisions Made");
    // The agent still completes the response in the same turn.
    expect(contents).toContain("END OF COMPACTED TURN.");

    await harness.streamChat("[dump] hi", { ...localAgent, chatId });
    const dump = harness.getServerDump({ type: "all-messages" });
    expect(dump.text).toContain("Key Decisions Made");
    expect(dump.text).toContain("END OF COMPACTED TURN.");
    expect(dump.text).toMatchSnapshot("compaction-mid-turn-transcript");
  }, 60_000);
});

// Migrated from e2e-tests/local_agent_code_search.spec.ts, then converted from
// the node chat-flow harness to the HYBRID harness (real <ChatPanel> over the
// real IPC stack).
//
// Exercises the local-agent code_search tool end-to-end: the fixture streams a
// code_search tool call, the real tool extracts the codebase and POSTs it to
// the (fake) Dyad Engine /tools/code-search endpoint, and the resulting
// <dyad-code-search> XML with the relevant files lands in the assistant
// message — now also asserted as the rendered Code Search tool card in the
// DOM. code_search requires Dyad Pro, and the engine fetch captures
// DYAD_ENGINE_URL at module load — hence the vi.hoisted engine server.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const engineServer = await vi.hoisted(async () => {
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const engineServer = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `${engineServer.url}/gateway/v1`;
  return engineServer;
});

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("local-agent code_search (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        // The e2e disabled the code explorer so code_search stays in the
        // toolset (explore_code supersedes it when available).
        enableCodeExplorer: false,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
    await engineServer.close();
  });

  it("searches the codebase via the engine code-search endpoint", async () => {
    harness.mount();

    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const { send } = await harness.typeInChat("tc=local-agent/code-search");
    send();

    // The code_search tool call renders its Code Search card in the DOM,
    // including the query in the card header.
    await waitFor(() => expect(screen.getByText("Code Search")).toBeTruthy(), {
      timeout: 20_000,
    });
    await waitFor(
      () => expect(screen.getByText("React component rendering")).toBeTruthy(),
      { timeout: 20_000 },
    );
    // The agent's final message text also renders.
    await waitFor(
      () => expect(screen.getByText(/I found the relevant files/)).toBeTruthy(),
      { timeout: 20_000 },
    );

    // Gate main-side (db) assertions on the real end-of-stream event.
    await harness.waitForStreamEnd(harness.chatId);
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const messages = await harness.db.query.messages.findMany({
      where: (messages, { eq }) => eq(messages.chatId, harness.chatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });
    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe("assistant");
    const content = assistant.content;

    expect(content).toContain(
      "I'll search for files related to React components in the codebase.",
    );
    expect(content).toContain(
      "I found the relevant files! The main React component is in src/App.tsx which handles the app rendering.",
    );

    // The completed tool XML holds the fake engine's result: the first three
    // codebase files echoed back as relevant paths.
    const xmlMatch = content.match(
      /<dyad-code-search query="React component rendering">([\s\S]*?)<\/dyad-code-search>/,
    );
    expect(xmlMatch).not.toBeNull();
    const resultText = xmlMatch![1];
    expect(resultText).not.toContain("No relevant files found.");
    // Three " - <path>" entries from the fake endpoint (slice(0, 3)).
    const entries = resultText
      .split("\n")
      .filter((line) => line.startsWith(" - "));
    expect(entries).toHaveLength(3);

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});

// Migrated from e2e-tests/local_agent_search_replace.spec.ts, then converted
// from the node chat-flow harness to the HYBRID harness (real <ChatPanel> over
// the real IPC stack). The e2e's core assertion was DOM-shaped
// (`getByTestId("dyad-search-replace")` visible), which the hybrid harness lets
// us assert directly while keeping every original file/db/git assertion.
//
// Runs the local agent (Agent v2) tool loop against the fake LLM server's
// `tc=local-agent/search-replace` fixture: read_file -> search_replace ->
// final text. Clicking the real Send button drives chat:stream; the streamed
// assistant message (with the search-replace tool card) renders in the DOM,
// then we gate the file/db assertions on the real end-of-stream event.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("local agent search_replace (hybrid)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("applies a targeted search_replace edit and renders the tool card", async () => {
    harness.mount();

    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const { send } = await harness.typeInChat("tc=local-agent/search-replace");
    send();

    // The agent's search_replace tool call renders its card in the DOM — the
    // same surface the Playwright spec asserted with
    // getByTestId("dyad-search-replace").
    await waitFor(
      () => expect(screen.getByTestId("dyad-search-replace")).toBeTruthy(),
      { timeout: 20_000 },
    );
    // The agent's final message text also renders.
    await waitFor(
      () =>
        expect(
          screen.getByText(/updated the message using search_replace/i),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );

    // Gate main-side (file/db/git) assertions on the real end-of-stream event.
    await harness.waitForStreamEnd(harness.chatId);

    // The local-agent branch signals success by the stream-end event and the
    // absence of error events (original node assertions, now read off the
    // renderer bridge that received the events).
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);
    expect(harness.bridge.sentEvents.map((e) => e.channel)).toContain(
      "chat:stream:end",
    );

    // The search_replace edit was applied verbatim.
    expect(harness.readAppFile("src/App.tsx").trim()).toBe(
      `const App = () => <div>Updated via search_replace</div>;

export default App;`,
    );

    // The assistant transcript includes the search-replace tool output.
    const messages = await harness.db.query.messages.findMany();
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain("dyad-search-replace");

    // The change was committed.
    expect(harness.gitLog().length).toBeGreaterThan(1);

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});

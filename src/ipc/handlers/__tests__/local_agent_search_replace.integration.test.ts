// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_search_replace.spec.ts.
//
// Runs the local agent (Agent v2) tool loop against the fake LLM server's
// `tc=local-agent/search-replace` fixture: read_file -> search_replace ->
// final text. Verifies the targeted edit was applied to src/App.tsx, the
// assistant message records the search-replace tool output, and the change
// was committed.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("local agent search_replace (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("applies a targeted search_replace edit", async () => {
    const { messages, eventsFor, events } = await harness.streamChat(
      "tc=local-agent/search-replace",
    );
    // The local-agent branch of chat:stream returns void; success is signaled
    // by the stream-end event and the absence of error events.
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(events.map((e) => e.channel)).toContain("chat:stream:end");

    // The search_replace edit was applied verbatim.
    expect(harness.readAppFile("src/App.tsx").trim()).toBe(
      `const App = () => <div>Updated via search_replace</div>;

export default App;`,
    );

    // The assistant transcript includes the search-replace tool output.
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain("dyad-search-replace");

    // The change was committed.
    expect(harness.gitLog().length).toBeGreaterThan(1);
  }, 30_000);
});

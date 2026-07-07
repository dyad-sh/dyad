// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_code_search.spec.ts.
//
// Exercises the local-agent code_search tool end-to-end: the fixture streams a
// code_search tool call, the real tool extracts the codebase and POSTs it to
// the (fake) Dyad Engine /tools/code-search endpoint, and the resulting
// <dyad-code-search> XML with the relevant files lands in the assistant
// message. code_search requires Dyad Pro, and the engine fetch captures
// DYAD_ENGINE_URL at module load — hence the vi.hoisted engine server.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const { startFakeLlmServer } =
    await import("../../../../testing/fake-llm-server/index");
  const engineServer = await startFakeLlmServer();
  process.env.DYAD_ENGINE_URL = `${engineServer.url}/engine/v1`;
  process.env.DYAD_GATEWAY_URL = `${engineServer.url}/gateway/v1`;
  return { ipcHandlers: new Map(), engineServer };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("local-agent code_search (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        // The e2e disabled the code explorer so code_search stays in the
        // toolset (explore_code supersedes it when available).
        enableCodeExplorer: false,
      },
    });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    await h.engineServer.close();
  });

  it("searches the codebase via the engine code-search endpoint", async () => {
    const { messages, eventsFor } = await harness.streamChat(
      "tc=local-agent/code-search",
      { requestedChatMode: "local-agent" },
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);

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
  }, 30_000);
});

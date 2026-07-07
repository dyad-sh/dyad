// @vitest-environment node
//
// Migrated from e2e-tests/ollama.spec.ts.
//
// The e2e pointed OLLAMA_HOST at the fake server's /ollama route, selected the
// "Testollama" model from the built-in Ollama (local) provider, sent "hi" and
// aria-snapshotted the rendered messages. Here we run the same flow through
// the real chat:stream handler: getModelClient's ollama branch reads
// OLLAMA_HOST at request time, the request hits /ollama/v1/chat/completions,
// and the canned <dyad-write> response is processed for real.
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

describe("ollama send message (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      // Built-in Ollama local provider, "testollama" model (the fake server's
      // /ollama/api/tags lists it as "Testollama").
      selectedModel: { provider: "ollama", name: "testollama" },
    });
    // Same env routing the e2e fixtures.ts applied before app launch; the
    // ollama branch reads process.env.OLLAMA_HOST at request time.
    process.env.OLLAMA_HOST = `${harness.fakeLlmUrl}/ollama`;
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    delete process.env.OLLAMA_HOST;
  });

  it("sends a message to ollama and processes the response", async () => {
    const { result, messages, eventsFor } = await harness.streamChat("hi");

    expect(result).toBe(harness.chatId);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    expect(messages).toHaveLength(2);
    const userMessage = messages.find((m) => m.role === "user")!;
    const assistantMessage = messages.find((m) => m.role === "assistant")!;
    expect(userMessage.content).toBe("hi");

    // An unmarked prompt gets the fake server's canned <dyad-write> reply;
    // receiving and applying it proves the ollama route round-tripped.
    expect(assistantMessage.content).toContain('<dyad-write path="file1.txt"');
    expect(assistantMessage.approvalState).toBe("approved");
    expect(harness.appFileExists("file1.txt")).toBe(true);
    expect(harness.readAppFile("file1.txt").trim()).toBe("A file (2)");
  }, 30_000);

  it("sends the request to the ollama route with the selected model", async () => {
    await harness.streamChat("[dump]");

    const unmasked = harness.getServerDump({
      type: "request",
      maskModel: false,
    });
    expect((unmasked.parsed as { body: { model: string } }).body.model).toBe(
      "testollama",
    );
  }, 30_000);
});

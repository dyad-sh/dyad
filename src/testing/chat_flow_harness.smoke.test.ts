// @vitest-environment node
//
// Smoke test for setupChatFlowHarness — this is the converted feasibility
// spike. It proves the full chat flow end-to-end: real chat:stream handler ->
// real AI-SDK HTTP streaming -> in-process fake-LLM server (serving
// e2e-tests/fixtures via tc=) -> real tag processor -> real file writes + git
// commit -> real sqlite.
//
// The repo default vitest environment is happy-dom, whose fetch enforces
// browser CORS and would block the AI SDK's request to the local fake LLM
// server. Main-process code needs plain node, hence the pragma above.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

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

describe("chat flow harness (smoke)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("streams dyad tags, writes files, commits, and records messages", async () => {
    const { result, events, messages, eventsFor } = await harness.streamChat(
      "tc=dyad-write-angle",
    );

    // Handler resolves with the chat id on success.
    expect(result).toBe(harness.chatId);

    // File write from the <dyad-write> tag in dyad-write-angle.md.
    expect(harness.appFileExists("src/foo/bar.tsx")).toBe(true);
    expect(harness.readAppFile("src/foo/bar.tsx")).toContain(
      "// BEGINNING OF FILE",
    );

    // Git commit of the applied change.
    expect(harness.gitLog().length).toBeGreaterThan(1);

    // DB messages.
    expect(messages).toHaveLength(2);
    const userMessage = messages.find((m) => m.role === "user")!;
    const assistantMessage = messages.find((m) => m.role === "assistant")!;
    expect(userMessage.content).toBe("tc=dyad-write-angle");
    expect(assistantMessage.content).toContain("<dyad-write");
    expect(assistantMessage.content).toContain("AFTER TAG");
    expect(assistantMessage.approvalState).toBe("approved");
    expect(assistantMessage.commitHash).toBeTruthy();

    // Renderer stream events.
    const channels = events.map((e) => e.channel);
    expect(channels).toContain("chat:stream:start");
    expect(channels).toContain("chat:response:chunk");
    expect(channels).toContain("chat:response:end");
    expect(channels).toContain("chat:stream:end");
    const responseEnd = events.find((e) => e.channel === "chat:response:end")!;
    expect(
      (responseEnd.payload as { updatedFiles: boolean }).updatedFiles,
    ).toBe(true);
    expect(eventsFor("chat:response:error")).toHaveLength(0);
  }, 30_000);

  it("second turn reuses the same chat and appends messages", async () => {
    // The real fake server returns a monotonic counter for "[increment]".
    const { result, messages } = await harness.streamChat("[increment]");
    expect(result).toBe(harness.chatId);
    expect(messages).toHaveLength(4);
    const lastAssistant = messages[messages.length - 1];
    expect(lastAssistant.role).toBe("assistant");
    expect(lastAssistant.content).toContain("counter=");
  }, 30_000);
});

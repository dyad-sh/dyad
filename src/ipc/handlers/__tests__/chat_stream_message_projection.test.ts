// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { messages } from "@/db/schema";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("legacy chat stream message projection", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("does not send main-process AI history in full message chunks", async () => {
    const mainOnlyPayload = "MAIN_PROCESS_ONLY_STREAM_HISTORY";
    await harness.db.insert(messages).values({
      chatId: harness.chatId,
      role: "assistant",
      content: "Visible agent response",
      aiMessagesJson: {
        sdkVersion: "ai@v6",
        messages: [{ role: "assistant", content: mainOnlyPayload }],
      },
    });

    const { eventsFor } = await harness.streamChat("tc=dyad-write-angle");
    const fullChunks = eventsFor("chat:response:chunk")
      .map((event) => event.payload)
      .filter(
        (payload): payload is { messages: Array<Record<string, unknown>> } =>
          typeof payload === "object" &&
          payload !== null &&
          Array.isArray((payload as { messages?: unknown }).messages),
      );

    // The initial placeholder refresh and post-auto-apply refresh are both
    // full chunks. Neither may expose the main-process-only agent history.
    expect(fullChunks).toHaveLength(2);
    for (const chunk of fullChunks) {
      expect(JSON.stringify(chunk)).not.toContain(mainOnlyPayload);
      expect(
        chunk.messages.every((message) => !("aiMessagesJson" in message)),
      ).toBe(true);
    }
  }, 30_000);
});

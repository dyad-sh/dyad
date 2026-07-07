// @vitest-environment node
//
// Migrated from e2e-tests/cancelled_message.spec.ts.
//
// Behavior under test: cancelling a stream mid-flight records the cancelled
// assistant message (with the "[Response cancelled by user]" notice the UI
// renders as the "Cancelled" indicator), and a follow-up request KEEPS the
// cancelled turn in the context sent to the LLM.
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
import {
  createFakeIpcEvent,
  type RendererEvent,
} from "@/testing/electron_mock";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("cancelled message (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("keeps the cancelled message in the chat and in the LLM context", async () => {
    // Start a stream whose fake response is delayed ([sleep=medium]) so we
    // can cancel it mid-flight, exactly like the e2e clicked "Cancel
    // generation".
    const streamPromise = harness.streamChat(
      "tc=cancelled-test [sleep=medium]",
    );

    // Give the handler time to register the active stream + start the request.
    await sleep(1_500);

    const cancelHandler = h.ipcHandlers.get("chat:cancel");
    expect(cancelHandler).toBeTruthy();
    const cancelEvents: RendererEvent[] = [];
    const cancelResult = await cancelHandler(
      createFakeIpcEvent(cancelEvents),
      harness.chatId,
    );
    // chat:cancel is a typed handler — its result arrives in an IPC envelope.
    expect(cancelResult).toMatchObject({ ok: true, value: true });

    // The cancel handler notifies the renderer that the stream ended cancelled.
    const endEvent = cancelEvents.find(
      (e) => e.channel === "chat:response:end",
    );
    expect(endEvent?.payload).toMatchObject({
      chatId: harness.chatId,
      wasCancelled: true,
    });

    const { messages } = await streamPromise;

    // Both the user prompt and the cancelled assistant message are kept.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("tc=cancelled-test [sleep=medium]");
    expect(messages[1].role).toBe("assistant");
    // This notice is what the UI renders as the "Cancelled" indicator.
    expect(messages[1].content).toContain("[Response cancelled by user]");

    // Follow-up turn: the cancelled exchange must be included in the payload
    // sent to the LLM.
    const followUp = await harness.streamChat("[dump] tc=follow-up");
    expect(followUp.eventsFor("chat:response:error")).toHaveLength(0);
    expect(followUp.messages).toHaveLength(4);

    const dump = harness.getServerDump();
    expect(dump.text).toContain("tc=cancelled-test");
    expect(dump.text).toContain("Response cancelled by user");
    expect(dump.text).toContain("[dump] tc=follow-up");
  }, 60_000);
});

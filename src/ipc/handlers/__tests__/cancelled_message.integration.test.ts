// Migrated from e2e-tests/cancelled_message.spec.ts, then converted from the
// node chat-flow harness to the HYBRID harness (real <ChatPanel> over the real
// IPC stack).
//
// Behavior under test: cancelling a stream mid-flight — by clicking the REAL
// Cancel control ChatInput renders while streaming (the stop button with
// aria-label "cancelGeneration") — records the cancelled assistant message,
// renders the "Cancelled" indicator in the message list, and a follow-up
// request KEEPS the cancelled turn in the context sent to the LLM.
//
// The real Cancel click consumes the chat:cancel result, but the bridge keeps
// the raw invoke envelope so this test can assert both the handler result and
// the renderer-observable cancelled end event.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("cancelled message (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("keeps the cancelled message in the chat and in the LLM context", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // Start a stream whose fake response is delayed ([sleep=medium]) so we
    // can cancel it mid-flight, exactly like the e2e clicked "Cancel
    // generation".
    const { send } = await harness.typeInChat(
      "tc=cancelled-test [sleep=medium]",
    );
    send();

    // While streaming, ChatInput swaps the Send button for the REAL Cancel
    // control (aria-label "cancelGeneration" via the i18n key).
    const cancelButton = await screen.findByLabelText(
      "cancelGeneration",
      {},
      { timeout: 15_000 },
    );

    // Deterministic pre-cancel gate (replaces a fixed 1.5s sleep): the stream
    // is registered (chat:stream:start fires synchronously at handler entry)
    // and both db rows exist — the user prompt and the assistant placeholder
    // that the cancel path annotates with "[Response cancelled by user]".
    await harness.waitForEvent(
      "chat:stream:start",
      (payload) =>
        !!payload &&
        typeof payload === "object" &&
        (payload as { chatId?: number }).chatId === harness.chatId,
    );
    await waitFor(
      async () => {
        const messages = await harness.db.query.messages.findMany();
        expect(messages.length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 15_000 },
    );

    // Click the real Cancel control (ChatInput.handleCancel -> chat:cancel).
    fireEvent.click(cancelButton);

    // The cancel handler notifies the renderer that the stream ended cancelled.
    const endEvent = await harness.waitForEvent(
      "chat:response:end",
      (payload) =>
        !!payload &&
        typeof payload === "object" &&
        (payload as { chatId?: number }).chatId === harness.chatId &&
        (payload as { wasCancelled?: boolean }).wasCancelled === true,
    );
    expect(endEvent.payload).toMatchObject({
      chatId: harness.chatId,
      wasCancelled: true,
    });
    await waitFor(() =>
      expect(harness.bridge.lastInvoke("chat:cancel")).toMatchObject({
        channel: "chat:cancel",
        status: "fulfilled",
        result: { ok: true, value: true },
      }),
    );

    // The "Cancelled" indicator renders on exactly two surfaces: the
    // cancelled prompt and the cancelled assistant message (the count the
    // retired e2e spec asserted).
    await waitFor(
      () => expect(screen.getAllByText("Cancelled")).toHaveLength(2),
      { timeout: 20_000 },
    );

    // Both the user prompt and the cancelled assistant message are kept.
    await waitFor(
      async () => {
        const messages = await harness.db.query.messages.findMany();
        expect(messages).toHaveLength(2);
        expect(messages[0].role).toBe("user");
        expect(messages[0].content).toBe("tc=cancelled-test [sleep=medium]");
        expect(messages[1].role).toBe("assistant");
        // This notice is what the UI renders as the "Cancelled" indicator.
        expect(messages[1].content).toContain("[Response cancelled by user]");
      },
      { timeout: 15_000 },
    );

    // Follow-up turn: the cancelled exchange must be included in the payload
    // sent to the LLM. Baseline-aware wait: the cancelled turn already emitted
    // a chat:response:end, so gate on a NEW one.
    const followUpEnd = harness.waitForNextStreamEnd(harness.chatId);
    const followUp = await harness.typeInChat("[dump] tc=follow-up");
    followUp.send();

    await waitFor(
      () => expect(screen.getByText("[dump] tc=follow-up")).toBeTruthy(),
      { timeout: 15_000 },
    );
    await followUpEnd;

    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);
    const afterFollowUp = await harness.db.query.messages.findMany();
    expect(afterFollowUp).toHaveLength(4);

    // The Cancelled indicator is still rendered for the first turn.
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);

    const dump = harness.getServerDump();
    expect(dump.text).toContain("tc=cancelled-test");
    expect(dump.text).toContain("Response cancelled by user");
    expect(dump.text).toContain("[dump] tc=follow-up");
  }, 60_000);
});

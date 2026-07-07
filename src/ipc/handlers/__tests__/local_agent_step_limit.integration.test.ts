// Migrated from e2e-tests/local_agent_step_limit.spec.ts, then converted from
// the node chat-flow harness to the HYBRID harness (real <ChatPanel> over the
// real IPC stack).
//
// The `tc=local-agent/step-limit` fixture streams 100 consecutive tool-call
// turns. The local agent's step limit (stepCountIs(100)) stops the loop and
// appends a <dyad-step-limit> notice instead of reaching the fixture's final
// "All steps completed." turn. The DyadStepLimit card ("Paused after 100 tool
// calls") renders in the DOM with a REAL Continue button; clicking it streams
// a new "Continue" prompt (the exact behavior the node version invoked
// directly), after which further prompts run normally.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

describe("local agent step limit (integration)", () => {
  let harness: HybridChatHarness;

  const loadMessages = () =>
    harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, harness.chatId),
      orderBy: [asc(messagesTable.id)],
    });

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
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

  it("pauses after 100 tool calls, holds a queued prompt, and drains it after Continue", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const streamStarted = harness.waitForEvent(
      "chat:stream:start",
      (payload) =>
        !!payload &&
        typeof payload === "object" &&
        (payload as { chatId?: number }).chatId === harness.chatId,
      60_000,
    );
    const { send } = await harness.typeInChat("tc=local-agent/step-limit");
    send();
    await streamStarted;

    // While the step-limit turn is streaming (the Cancel control is up),
    // submit a second prompt via the real Lexical Enter path — it QUEUES
    // instead of sending, exactly like the e2e's mid-stream Enter press.
    await screen.findByLabelText(
      /^(cancelGeneration|Cancel generation)$/,
      {},
      {
        timeout: 60_000,
      },
    );
    await harness.pressEnterInChat("tc=local-agent/simple-response");
    await waitFor(() => expect(screen.getByText("1 Queued")).toBeTruthy(), {
      timeout: 15_000,
    });

    // The DyadStepLimit pause card renders in the DOM — the same surface the
    // e2e asserted — with the real Continue control.
    await waitFor(
      () =>
        expect(screen.getByText("Paused after 100 tool calls")).toBeTruthy(),
      { timeout: 90_000 },
    );
    await waitFor(
      () =>
        expect(
          screen.getByText(/Automatically paused after 100 tool calls\./),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );

    await harness.waitForStreamEnd(harness.chatId, 90_000);
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    // The pause holds the queue: the "Paused" chip renders and the queued
    // prompt has NOT been sent (not in the messages list, not in the db).
    await waitFor(
      () => expect(screen.getByText("Paused", { exact: true })).toBeTruthy(),
      { timeout: 15_000 },
    );
    expect(screen.getByText("1 Queued")).toBeTruthy();
    expect(
      within(screen.getByTestId("messages-list")).queryByText(
        "tc=local-agent/simple-response",
      ),
    ).toBeNull();

    const messages = await loadMessages();
    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    // Paused: the step-limit notice is appended...
    expect(assistant.content).toContain('<dyad-step-limit steps="100"');
    expect(assistant.content).toContain(
      "Automatically paused after 100 tool calls.",
    );
    // ...and the fixture's final turn was never reached.
    expect(assistant.content).not.toContain("All steps completed.");
    // The fixture's final turn text never rendered either.
    expect(screen.queryByText(/All steps completed\./)).toBeNull();
    expect(
      messages.some((m) => m.content === "tc=local-agent/simple-response"),
    ).toBe(false);

    // Click the REAL DyadStepLimit "Continue" button — it streams a plain
    // "Continue" prompt (the step-limit turn's end was consumed above, so
    // this waitForStreamEnd gates on the continue turn).
    const continueButton = await screen.findByRole("button", {
      name: /Continue/,
    });
    fireEvent.click(continueButton);
    await harness.waitForStreamEnd(harness.chatId, 90_000);

    const continueMessages = await loadMessages();
    const continueAssistant = continueMessages
      .filter((m) => m.role === "assistant")
      .at(-1)!;
    expect(continueAssistant.content).not.toContain("<dyad-step-limit");

    // Continue resumes the queue: the queued prompt drains and streams as its
    // own turn — the queue×step-limit interaction unique to this test.
    await waitFor(
      () =>
        expect(
          within(screen.getByTestId("messages-list")).getByText(
            "tc=local-agent/simple-response",
          ),
        ).toBeTruthy(),
      { timeout: 30_000 },
    );
    await harness.waitForStreamEnd(harness.chatId, 90_000);
    await waitFor(
      () =>
        expect(
          screen.getByText(
            /This is a simple response from the Basic Agent mode\./,
          ),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );
    // The queue chip is gone once drained.
    await waitFor(() => expect(screen.queryByText(/\d+ Queued/)).toBeNull(), {
      timeout: 15_000,
    });
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const drainedMessages = await loadMessages();
    expect(
      drainedMessages.some(
        (m) =>
          m.role === "user" && m.content === "tc=local-agent/simple-response",
      ),
    ).toBe(true);
    const drainedAssistant = drainedMessages
      .filter((m) => m.role === "assistant")
      .at(-1)!;
    expect(drainedAssistant.content).toContain(
      "Hello! I understand your request. This is a simple response from the Basic Agent mode.",
    );

    // A fresh mount = a fresh jotai store (like an app restart): the queue is
    // ephemeral, but the persisted conversation — including the step-limit
    // notice card — renders from the db. Same test as the flow that produced
    // that conversation so it can't be orphaned by test reordering.
    cleanup();
    harness.mount();

    await waitFor(
      () =>
        expect(screen.getByText("Paused after 100 tool calls")).toBeTruthy(),
      { timeout: 15_000 },
    );
    await waitFor(
      () =>
        expect(
          screen.getByText(
            /This is a simple response from the Basic Agent mode\./,
          ),
        ).toBeTruthy(),
      { timeout: 15_000 },
    );
    // The queue did not leak across the remount.
    expect(screen.queryByText(/\d+ Queued/)).toBeNull();

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 240_000);
});

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

import { fireEvent, screen, waitFor } from "@testing-library/react";

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

  it("pauses after 100 tool calls with a dyad-step-limit notice", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const { send } = await harness.typeInChat("tc=local-agent/step-limit");
    send();

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

    // The Continue button is rendered on the finished pause card.
    expect(
      await screen.findByRole("button", { name: /Continue/ }),
    ).toBeTruthy();

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
  }, 120_000);

  it("continues after the pause and processes the next prompt", async () => {
    harness.mount();

    // The persisted step-limit pause card re-renders with its Continue button.
    const continueButton = await screen.findByRole(
      "button",
      { name: /Continue/ },
      { timeout: 15_000 },
    );

    // Click the REAL DyadStepLimit "Continue" button — it streams a plain
    // "Continue" prompt. Baseline-aware end gate: the previous it already
    // produced a chat:response:end on this bridge.
    const continueEnd = harness.waitForNextStreamEnd(harness.chatId, 90_000);
    fireEvent.click(continueButton);
    await continueEnd;
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const continueMessages = await loadMessages();
    const continueAssistant = continueMessages
      .filter((m) => m.role === "assistant")
      .at(-1)!;
    expect(continueAssistant.content).not.toContain("<dyad-step-limit");

    // The queued follow-up prompt from the e2e test then runs normally.
    const followUpEnd = harness.waitForNextStreamEnd(harness.chatId, 90_000);
    const { send } = await harness.typeInChat("tc=local-agent/simple-response");
    send();

    // The follow-up's streamed response renders in the DOM.
    await waitFor(
      () =>
        expect(
          screen.getByText(
            /This is a simple response from the Basic Agent mode\./,
          ),
        ).toBeTruthy(),
      { timeout: 20_000 },
    );

    await followUpEnd;
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const followUpMessages = await loadMessages();
    const followUpAssistant = followUpMessages
      .filter((m) => m.role === "assistant")
      .at(-1)!;
    expect(followUpAssistant.content).toContain(
      "Hello! I understand your request. This is a simple response from the Basic Agent mode.",
    );

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 120_000);
});

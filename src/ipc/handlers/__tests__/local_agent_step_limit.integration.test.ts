// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_step_limit.spec.ts.
//
// The `tc=local-agent/step-limit` fixture streams 100 consecutive tool-call
// turns. The local agent's step limit (stepCountIs(100)) stops the loop and
// appends a <dyad-step-limit> notice instead of reaching the fixture's final
// "All steps completed." turn. Clicking "Continue" in the UI simply streams a
// new "Continue" prompt, after which further prompts (the queued
// `tc=local-agent/simple-response` in the e2e test) run normally.
//
// UI-only assertions from the e2e spec (pause card visibility, "1 Queued"
// badge, queued-input behavior, Continue button rendering) are dropped; the
// ported behavior is the step-limit pause tag, the resumed stream, and the
// follow-up prompt completing.
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

describe("local agent step limit (integration)", () => {
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

  it("pauses after 100 tool calls with a dyad-step-limit notice", async () => {
    const { messages, eventsFor } = await harness.streamChat(
      "tc=local-agent/step-limit",
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    // Paused: the step-limit notice is appended...
    expect(assistant.content).toContain('<dyad-step-limit steps="100"');
    expect(assistant.content).toContain(
      "Automatically paused after 100 tool calls.",
    );
    // ...and the fixture's final turn was never reached.
    expect(assistant.content).not.toContain("All steps completed.");
  }, 120_000);

  it("continues after the pause and processes the next prompt", async () => {
    // The DyadStepLimit "Continue" button streams a plain "Continue" prompt.
    const continueResult = await harness.streamChat("Continue");
    expect(continueResult.eventsFor("chat:response:error")).toHaveLength(0);
    const continueAssistant = continueResult.messages
      .filter((m) => m.role === "assistant")
      .at(-1)!;
    expect(continueAssistant.content).not.toContain("<dyad-step-limit");

    // The queued follow-up prompt from the e2e test then runs normally.
    const followUp = await harness.streamChat("tc=local-agent/simple-response");
    expect(followUp.eventsFor("chat:response:error")).toHaveLength(0);
    const followUpAssistant = followUp.messages
      .filter((m) => m.role === "assistant")
      .at(-1)!;
    expect(followUpAssistant.content).toContain(
      "Hello! I understand your request. This is a simple response from the Basic Agent mode.",
    );
  }, 120_000);
});

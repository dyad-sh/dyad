// Exercises the local-agent run_tests tool end-to-end over the HYBRID harness
// (real <ChatPanel> over the real IPC stack). The fixture writes a spec, then
// calls run_tests. No dev server is running in the harness, so the real tool
// short-circuits on its dev-server pre-check and returns the actionable "app
// isn't running" warning (uncounted) — a deterministic path that avoids running
// Playwright-inside-Playwright. Asserts the tool XML + narration land in the
// persisted assistant message.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("local-agent run_tests (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        enableCodeExplorer: false,
      },
    });
    // The run_tests tool is gated on the app having opted into testing.
    await harness.db
      .update(apps)
      .set({ testingEnabled: true })
      .where(eq(apps.id, harness.appId));
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("runs the tool and reports the app isn't running (uncounted)", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const { send } = await harness.typeInChat("tc=local-agent/run-tests");
    send();

    await harness.waitForStreamEnd(harness.chatId);
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const messages = await harness.db.query.messages.findMany();
    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe("assistant");
    const content = assistant.content;

    // Narration from both turns.
    expect(content).toContain(
      "I'll write an end-to-end test for the home page.",
    );
    expect(content).toContain("Now let me run the test to verify it works.");

    // The run_tests tool ran and returned the dev-server warning, uncounted.
    expect(content).toContain('<dyad-output type="warning"');
    expect(content).toContain("dev server isn't running");
    expect(content).toContain("did NOT count as a fix attempt");

    // The spec was written to disk.
    expect(content).toContain("e2e-tests/home.spec.ts");

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});

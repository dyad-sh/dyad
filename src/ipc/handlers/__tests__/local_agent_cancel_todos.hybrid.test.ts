// Migrated from e2e-tests/local_agent_cancel_todos.spec.ts to the HYBRID
// harness: real <ChatPanel>, real local-agent stream, real todo persistence,
// and real renderer todo wiring.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("local-agent cancel todos (integration)", () => {
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
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("clears visible and persisted todos when a turn is cancelled", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );
    await harness.selectChatMode("local-agent");

    const todosDir = path.join(harness.appDir, ".dyad", "todos");
    const { send } = await harness.typeInChat("tc=local-agent/cancel-todos");
    send();

    await screen.findByText("First cancellable task", {}, { timeout: 20_000 });
    await waitFor(() => {
      expect(fs.existsSync(todosDir)).toBe(true);
      expect(fs.readdirSync(todosDir).length).toBeGreaterThan(0);
    });

    const cancelButton = await screen.findByLabelText(
      "cancelGeneration",
      {},
      { timeout: 15_000 },
    );
    fireEvent.click(cancelButton);

    const endEvent = await harness.waitForEvent(
      "chat:response:end",
      (payload) =>
        !!payload &&
        typeof payload === "object" &&
        (payload as { chatId?: number }).chatId === harness.chatId &&
        (payload as { wasCancelled?: boolean }).wasCancelled === true,
      60_000,
    );
    expect(endEvent.payload).toMatchObject({
      chatId: harness.chatId,
      wasCancelled: true,
    });

    await waitFor(() =>
      expect(screen.queryByText("First cancellable task")).toBeNull(),
    );
    await waitFor(() => {
      const remaining = fs.existsSync(todosDir) ? fs.readdirSync(todosDir) : [];
      expect(remaining).toHaveLength(0);
    });
  }, 90_000);
});

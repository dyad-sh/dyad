import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { messages } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("local-agent grep cards (integration)", () => {
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
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("renders grep cards and expands their results", async () => {
    harness.mount();
    await harness.selectChatMode("local-agent");

    const { send } = await harness.typeInChat("tc=local-agent/grep-search");
    send();

    await waitFor(
      () => expect(screen.getAllByTestId("dyad-grep")).toHaveLength(2),
      { timeout: 20_000 },
    );
    const cards = screen.getAllByTestId("dyad-grep");
    expect(cards[0].textContent).toContain('"createRoot"');
    expect(cards[1].textContent).toContain('"App"');

    fireEvent.click(cards[0]);
    fireEvent.click(cards[1]);
    expect(cards[0].getAttribute("aria-expanded")).toBe("true");
    expect(cards[1].getAttribute("aria-expanded")).toBe("true");

    await harness.waitForStreamEnd(harness.chatId);
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const storedMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, harness.chatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });
    const assistantContent = storedMessages.at(-1)?.content;
    expect(assistantContent).toContain("<dyad-grep");
    expect(assistantContent).toContain("src/main.tsx");
    expect(assistantContent).toContain("src/App.tsx");
  }, 60_000);

  it("can include ignored files when the agent requests them", async () => {
    const ignoredPackageDir = path.join(
      harness.appDir,
      "node_modules",
      "ignored-pkg",
    );
    fs.mkdirSync(ignoredPackageDir, { recursive: true });
    fs.writeFileSync(
      path.join(ignoredPackageDir, "index.js"),
      "export const ignoredNeedle = 'search ignored files';\n",
    );

    const chatId = await harness.createChat();
    harness.mount({ chatId });
    await harness.selectChatMode("local-agent");

    const { send } = await harness.typeInChat(
      "tc=local-agent/grep-include-ignored",
      { chatId },
    );
    send();

    const grepCard = await screen.findByTestId("dyad-grep", undefined, {
      timeout: 20_000,
    });
    await waitFor(() =>
      expect(grepCard.textContent).toContain("ignoredNeedle"),
    );
    fireEvent.click(grepCard);
    await harness.waitForStreamEnd(chatId);
    expect(grepCard.getAttribute("aria-expanded")).toBe("true");
    expect(grepCard.textContent).toContain("ignoredNeedle");
    const storedMessages = await harness.db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });
    expect(storedMessages.at(-1)?.content).toContain(
      "node_modules/ignored-pkg/index.js",
    );
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);
  }, 60_000);
});

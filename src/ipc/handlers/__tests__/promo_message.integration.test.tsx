import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { eq } from "drizzle-orm";

import { language_models } from "@/db/schema";
import type { UserBudgetInfo } from "@/ipc/types";
import { writeSettings } from "@/main/settings";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

const USER_BUDGET: NonNullable<UserBudgetInfo> = {
  usedCredits: 100,
  totalCredits: 1000,
  budgetResetDate: new Date("2026-08-01"),
  redactedUserId: "****1234",
  isTrial: false,
};

const URL_CTA_LABELS = [
  "Star on GitHub",
  "Join r/dyadbuilders",
  "Follow @dyad_sh",
] as const;

async function setContextWindow(
  harness: HybridChatHarness,
  contextWindow: number,
) {
  await harness.db
    .update(language_models)
    .set({ context_window: contextWindow })
    .where(eq(language_models.apiName, "test-model"));
}

function setBudgetHandler(
  harness: HybridChatHarness,
  budget: UserBudgetInfo | null,
) {
  harness.electronMock.ipcHandlers.set("get-user-budget", async () => budget);
}

function resetNonProSettings() {
  writeSettings({
    enableDyadPro: false,
    providerSettings: {},
    isTestMode: false,
  });
}

async function sendFixtureTurn(
  harness: HybridChatHarness,
  chatId: number,
  fixture = "tc=no-code-response",
) {
  const { send } = await harness.typeInChat(fixture, { chatId });
  send();
  await harness.waitForStreamEnd(chatId);
}

describe("promo message (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      autoApprove: true,
      settings: {
        enableDyadPro: false,
        isTestMode: false,
        providerSettings: {},
      },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
    resetNonProSettings();
    setBudgetHandler(harness, null);
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows a promo after a non-Pro user starts a stream and keeps it after the stream ends", async () => {
    resetNonProSettings();
    setBudgetHandler(harness, null);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    const { send } = await harness.typeInChat("tc=no-code-response", {
      chatId,
    });
    send();

    const promo = await screen.findByTestId(
      "promo-message",
      {},
      { timeout: 15_000 },
    );
    expect(promo.textContent).toMatch(/Dyad|GitHub|subreddit|X/);
    expect(within(promo).getByRole("button")).toBeTruthy();

    await harness.waitForStreamEnd(chatId);
    expect(screen.getByTestId("promo-message")).toBe(promo);
  }, 60_000);

  it("does not show a promo when the user has a Pro key", async () => {
    writeSettings({
      enableDyadPro: true,
      providerSettings: {
        auto: { apiKey: { value: "dyad-pro-key" } },
      },
      isTestMode: false,
    });
    setBudgetHandler(harness, null);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await sendFixtureTurn(harness, chatId);

    await waitFor(() =>
      expect(screen.queryByTestId("promo-message")).toBeNull(),
    );
  }, 60_000);

  it("does not show a promo when the user has budget info", async () => {
    resetNonProSettings();
    setBudgetHandler(harness, USER_BUDGET);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await sendFixtureTurn(harness, chatId);

    await waitFor(() =>
      expect(screen.queryByTestId("promo-message")).toBeNull(),
    );
  }, 60_000);

  it("lets the context limit banner win when both caps are eligible", async () => {
    resetNonProSettings();
    setBudgetHandler(harness, null);
    await setContextWindow(harness, 128_000);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await sendFixtureTurn(
      harness,
      chatId,
      "tc=context-limit-response [high-tokens=110000]",
    );

    const banner = await screen.findByTestId(
      "context-limit-banner",
      {},
      { timeout: 15_000 },
    );
    expect(banner.textContent).toContain("This chat context is running out");
    expect(screen.queryByTestId("promo-message")).toBeNull();
  }, 60_000);

  it("opens the trial dialog from a Pro promo CTA", async () => {
    resetNonProSettings();
    setBudgetHandler(harness, null);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    await sendFixtureTurn(harness, chatId);

    fireEvent.click(
      screen.getByRole("button", {
        name: /Start Free Trial|Get Dyad Pro|Unlock Dyad Pro/,
      }),
    );
    expect(await screen.findByText("Unlock Dyad Pro")).toBeTruthy();
  }, 60_000);

  it("opens an external URL from a community promo CTA", async () => {
    resetNonProSettings();
    setBudgetHandler(harness, null);
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    let clickedLabel: string | undefined;
    for (let attempt = 0; attempt < 16 && !clickedLabel; attempt++) {
      await sendFixtureTurn(harness, chatId);
      const promo = await screen.findByTestId(
        "promo-message",
        {},
        { timeout: 15_000 },
      );
      for (const label of URL_CTA_LABELS) {
        const button = within(promo).queryByRole("button", { name: label });
        if (button) {
          fireEvent.click(button);
          clickedLabel = label;
          break;
        }
      }
    }

    expect(clickedLabel).toBeDefined();
    let openExternalCall = harness.bridge.invokeLog
      .filter((entry) => entry.channel === "open-external-url")
      .at(-1);
    await waitFor(() => {
      openExternalCall = harness.bridge.invokeLog
        .filter((entry) => entry.channel === "open-external-url")
        .at(-1);
      expect(openExternalCall?.status).toBe("fulfilled");
    });
    expect(openExternalCall?.args[0]).toMatch(
      /^https:\/\/(github\.com\/dyad-sh\/dyad|www\.reddit\.com\/r\/dyadbuilders\/|x\.com\/dyad_sh)/,
    );
  }, 120_000);
});

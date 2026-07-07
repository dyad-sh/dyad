import { describe, expect, it } from "vitest";
import type { UserBudgetInfo } from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";
import {
  pickPromoMessage,
  PROMO_MESSAGES,
  shouldShowPromoMessage,
} from "./PromoMessage";

function settingsWithAutoKey(autoKey?: string): UserSettings {
  return {
    selectedModel: { provider: "auto", name: "auto" },
    providerSettings: autoKey ? { auto: { apiKey: { value: autoKey } } } : {},
    selectedTemplateId: "react",
  } as UserSettings;
}

const budget: NonNullable<UserBudgetInfo> = {
  usedCredits: 0,
  totalCredits: 1000,
  budgetResetDate: new Date("2026-07-01"),
  redactedUserId: "****1234",
  isTrial: false,
};

describe("pickPromoMessage", () => {
  it("always returns a configured message", () => {
    for (let seed = 0; seed < 500; seed++) {
      expect(PROMO_MESSAGES).toContain(pickPromoMessage(seed));
    }
  });

  it("is deterministic for a given seed", () => {
    expect(pickPromoMessage(42)).toBe(pickPromoMessage(42));
  });

  it("weights Pro promos above community tips", () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 3000; seed++) {
      const message = pickPromoMessage(seed);
      counts.set(message.id, (counts.get(message.id) ?? 0) + 1);
    }

    let proCount = 0;
    let communityCount = 0;
    for (const message of PROMO_MESSAGES) {
      const count = counts.get(message.id) ?? 0;
      expect(count).toBeGreaterThan(0);
      if (message.target.type === "trial-dialog") {
        proCount += count;
      } else {
        communityCount += count;
      }
    }
    // Pro promos carry 12 of 15 weight → ~80% of impressions.
    expect(proCount / (proCount + communityCount)).toBeGreaterThan(0.7);
  });
});

describe("shouldShowPromoMessage", () => {
  it("shows for a non-Pro user even when the Dyad Pro toggle is enabled", () => {
    const settings = {
      ...settingsWithAutoKey(),
      enableDyadPro: true,
    };

    expect(
      shouldShowPromoMessage({
        promoSeed: 123,
        settings,
        userBudget: null,
        messagesLength: 2,
      }),
    ).toBe(true);
  });

  it("hides when the user has a Pro key or budget", () => {
    expect(
      shouldShowPromoMessage({
        promoSeed: 123,
        settings: settingsWithAutoKey("dyad-pro-key"),
        userBudget: null,
        messagesLength: 2,
      }),
    ).toBe(false);

    expect(
      shouldShowPromoMessage({
        promoSeed: 123,
        settings: settingsWithAutoKey(),
        userBudget: budget,
        messagesLength: 2,
      }),
    ).toBe(false);
  });

  it("hides without an active promo, in test mode, or before any messages", () => {
    expect(
      shouldShowPromoMessage({
        promoSeed: null,
        settings: settingsWithAutoKey(),
        userBudget: null,
        messagesLength: 2,
      }),
    ).toBe(false);

    expect(
      shouldShowPromoMessage({
        promoSeed: 123,
        settings: { ...settingsWithAutoKey(), isTestMode: true },
        userBudget: null,
        messagesLength: 2,
      }),
    ).toBe(false);

    expect(
      shouldShowPromoMessage({
        promoSeed: 123,
        settings: settingsWithAutoKey(),
        userBudget: null,
        messagesLength: 0,
      }),
    ).toBe(false);
  });
});

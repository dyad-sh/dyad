import { describe, expect, it } from "vitest";
import {
  LOCAL_PRODUCT_NUDGES,
  PRODUCT_NUDGE_COOLDOWN_MS,
  selectProductNudge,
} from "@/lib/productNudges";
import type { UserSettings } from "@/lib/schemas";

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { provider: "auto", name: "auto" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    selectedChatMode: "build",
    dismissedProductNudgeIds: [],
    actionedProductNudgeIds: [],
    ...overrides,
  } as UserSettings;
}

describe("product nudges", () => {
  it("selects the highest-priority eligible nudge", () => {
    const nudge = selectProductNudge({
      nudges: LOCAL_PRODUCT_NUDGES,
      settings: makeSettings(),
      now: 10_000,
    });

    expect(nudge?.id).toBe("chat-notifications");
  });

  it("does not select dismissed or actioned nudges", () => {
    const nudge = selectProductNudge({
      nudges: LOCAL_PRODUCT_NUDGES,
      settings: makeSettings({
        skipNotificationBanner: true,
        dismissedProductNudgeIds: ["anonymous-telemetry"],
        actionedProductNudgeIds: ["dyad-pro-trial"],
      }),
      now: 10_000,
    });

    expect(nudge).toBeNull();
  });

  it("honors the global product tips opt-out", () => {
    const nudge = selectProductNudge({
      nudges: LOCAL_PRODUCT_NUDGES,
      settings: makeSettings({ disableProductTips: true }),
      now: 10_000,
    });

    expect(nudge).toBeNull();
  });

  it("waits before selecting a different nudge after one was shown", () => {
    const nudge = selectProductNudge({
      nudges: LOCAL_PRODUCT_NUDGES,
      settings: makeSettings({
        skipNotificationBanner: true,
        lastShownProductNudgeAt: 10_000,
      }),
      now: 10_000 + PRODUCT_NUDGE_COOLDOWN_MS - 1,
    });

    expect(nudge).toBeNull();
  });

  it("keeps the currently visible nudge during the cooldown", () => {
    const nudge = selectProductNudge({
      nudges: LOCAL_PRODUCT_NUDGES,
      settings: makeSettings({
        lastShownProductNudgeAt: 10_000,
      }),
      now: 10_000 + PRODUCT_NUDGE_COOLDOWN_MS - 1,
      currentNudgeId: "chat-notifications",
    });

    expect(nudge?.id).toBe("chat-notifications");
  });

  it("shows the GitHub star bonus nudge only in Basic Agent mode", () => {
    const nudge = selectProductNudge({
      nudges: LOCAL_PRODUCT_NUDGES,
      settings: makeSettings({
        skipNotificationBanner: true,
        telemetryConsent: "opted_in",
        actionedProductNudgeIds: ["dyad-pro-trial"],
        selectedChatMode: "local-agent",
      }),
      now: 10_000,
    });

    expect(nudge?.id).toBe("github-star-basic-agent-bonus");
  });
});

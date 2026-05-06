import { z } from "zod";
import { hasDyadProKey, isBasicAgentMode, type UserSettings } from "./schemas";

export const PRODUCT_NUDGE_COOLDOWN_MS = 60 * 60 * 1000;
export const CHAT_NOTIFICATIONS_NUDGE_ID = "chat-notifications";
export const GITHUB_STAR_BONUS_NUDGE_ID = "github-star-basic-agent-bonus";

const HttpsUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith("https://"), {
    message: "URL must use HTTPS",
  });

export const ProductNudgeEligibilitySchema = z.enum([
  "chat-notifications-disabled",
  "telemetry-not-enabled",
  "basic-agent-mode",
  "missing-dyad-pro-key",
]);

export const ProductNudgeActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("enable-chat-notifications"),
  }),
  z.object({
    type: z.literal("enable-telemetry"),
  }),
  z.object({
    type: z.literal("open-url"),
    url: HttpsUrlSchema,
  }),
  z.object({
    type: z.literal("open-pro-trial-dialog"),
  }),
  z.object({
    type: z.literal("claim-github-star-bonus"),
    url: HttpsUrlSchema,
    bonusMessages: z.number().int().positive().default(10),
  }),
]);

export const ProductNudgeSchema = z.object({
  id: z.string().min(1),
  message: z.string().min(1),
  actionLabel: z.string().min(1),
  action: ProductNudgeActionSchema,
  eligibility: z.array(ProductNudgeEligibilitySchema).default([]),
  priority: z.number().default(0),
  icon: z.enum(["bell", "chart", "sparkles", "star"]).default("sparkles"),
});

export const ProductNudgesResponseSchema = z.object({
  nudges: z.array(ProductNudgeSchema),
});

export type ProductNudge = z.infer<typeof ProductNudgeSchema>;
export type ProductNudgeEligibility = z.infer<
  typeof ProductNudgeEligibilitySchema
>;
export type ProductNudgesResponse = z.infer<typeof ProductNudgesResponseSchema>;

export const LOCAL_PRODUCT_NUDGES: ProductNudge[] = [
  {
    id: CHAT_NOTIFICATIONS_NUDGE_ID,
    message: "Get notified about chat events.",
    actionLabel: "Enable",
    action: { type: "enable-chat-notifications" },
    eligibility: ["chat-notifications-disabled"],
    priority: 100,
    icon: "bell",
  },
  {
    id: "anonymous-telemetry",
    message: "Allow anonymous usage data to help improve Dyad?",
    actionLabel: "Allow",
    action: { type: "enable-telemetry" },
    eligibility: ["telemetry-not-enabled"],
    priority: 80,
    icon: "chart",
  },
  {
    id: GITHUB_STAR_BONUS_NUDGE_ID,
    message:
      "Get 10 extra Basic Agent messages today if you star our GitHub repo.",
    actionLabel: "Star Dyad",
    action: {
      type: "claim-github-star-bonus",
      url: "https://github.com/dyad-sh/dyad",
      bonusMessages: 10,
    },
    eligibility: ["basic-agent-mode"],
    priority: 70,
    icon: "star",
  },
  {
    id: "dyad-pro-trial",
    message: "Try a free Dyad Pro trial and get 50 AI credits on us.",
    actionLabel: "Start Trial",
    action: { type: "open-pro-trial-dialog" },
    eligibility: ["missing-dyad-pro-key"],
    priority: 60,
    icon: "sparkles",
  },
];

export function selectProductNudge({
  nudges,
  settings,
  now,
  currentNudgeId,
}: {
  nudges: ProductNudge[];
  settings: UserSettings;
  now: number;
  currentNudgeId?: string | null;
}): ProductNudge | null {
  if (settings.disableProductTips === true) {
    return null;
  }

  if (currentNudgeId) {
    const current = nudges.find((nudge) => nudge.id === currentNudgeId);
    if (current && isProductNudgeEligible(current, settings)) {
      return current;
    }
  }

  if (isProductNudgeCooldownActive(settings, now)) {
    return null;
  }

  return getSortedEligibleProductNudges(nudges, settings)[0] ?? null;
}

export function getSortedEligibleProductNudges(
  nudges: ProductNudge[],
  settings: UserSettings,
): ProductNudge[] {
  return nudges
    .filter((nudge) => isProductNudgeEligible(nudge, settings))
    .sort((a, b) => b.priority - a.priority);
}

export function isProductNudgeEligible(
  nudge: ProductNudge,
  settings: UserSettings,
): boolean {
  if (isProductNudgeBlocked(nudge.id, settings)) {
    return false;
  }

  return nudge.eligibility.every((condition) =>
    isProductNudgeConditionMet(condition, settings),
  );
}

export function isProductNudgeBlocked(
  nudgeId: string,
  settings: UserSettings,
): boolean {
  if (settings.dismissedProductNudgeIds?.includes(nudgeId)) {
    return true;
  }
  if (settings.actionedProductNudgeIds?.includes(nudgeId)) {
    return true;
  }

  return (
    nudgeId === CHAT_NOTIFICATIONS_NUDGE_ID &&
    settings.skipNotificationBanner === true
  );
}

export function isProductNudgeCooldownActive(
  settings: Pick<UserSettings, "lastShownProductNudgeAt">,
  now: number,
): boolean {
  const lastShownAt = settings.lastShownProductNudgeAt;
  return (
    typeof lastShownAt === "number" &&
    now - lastShownAt < PRODUCT_NUDGE_COOLDOWN_MS
  );
}

function isProductNudgeConditionMet(
  condition: ProductNudgeEligibility,
  settings: UserSettings,
): boolean {
  switch (condition) {
    case "chat-notifications-disabled":
      return settings.enableChatEventNotifications !== true;
    case "telemetry-not-enabled":
      return settings.telemetryConsent !== "opted_in";
    case "basic-agent-mode":
      return isBasicAgentMode(settings);
    case "missing-dyad-pro-key":
      return !hasDyadProKey(settings);
  }
}

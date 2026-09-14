import { z } from "zod";
import {
  getCodexSubscriptionCredentials,
  getCodexSubscriptionStatus,
} from "./codex_subscription_auth";

const Window = z.object({
  used_percent: z.number().finite().nonnegative(),
  limit_window_seconds: z.number().positive(),
  reset_at: z.number().nonnegative(),
});
const Usage = z.object({
  rate_limit: z
    .object({
      allowed: z.boolean(),
      limit_reached: z.boolean(),
      primary_window: Window.nullish(),
      secondary_window: Window.nullish(),
    })
    .nullish(),
});
export type SubscriptionWindow = {
  usedPercent: number;
  windowSeconds: number;
  resetsAt: number;
};
let cached: {
  models: string[];
  windows: SubscriptionWindow[];
  limitReached: boolean;
  error?: string;
  modelsError?: string;
  limitsError?: string;
} = { models: [], windows: [], limitReached: false };
let updatedAt = 0;
let revision = 0;
let inflight: Promise<void> | undefined;
export function resetSubscriptionAccount() {
  revision++;
  cached = { models: [], windows: [], limitReached: false };
  updatedAt = 0;
  inflight = undefined;
}
export function markSubscriptionLimited() {
  cached.limitReached = true;
  updatedAt = 0;
}
export function parseSubscriptionLimits(raw: unknown) {
  const limit = Usage.parse(raw).rate_limit;
  if (!limit) throw new Error("Missing usage limits");
  return {
    limitReached: limit.limit_reached || !limit.allowed,
    windows: [limit.primary_window, limit.secondary_window].flatMap((w) =>
      w
        ? [
            {
              usedPercent: w.used_percent,
              windowSeconds: w.limit_window_seconds,
              resetsAt: w.reset_at * 1000,
            },
          ]
        : [],
    ),
  };
}
export async function getSubscriptionAccount() {
  const status = getCodexSubscriptionStatus();
  if (!status.connected)
    return { ...status, models: [], windows: [], limitReached: false };
  if (!inflight && Date.now() - updatedAt > 60_000) {
    const current = revision;
    inflight = (async () => {
      try {
        const credentials = await getCodexSubscriptionCredentials();
        if (current === revision) cached.error = undefined;
        const headers = {
          Authorization: `Bearer ${credentials.access}`,
          "ChatGPT-Account-Id": credentials.accountId,
        };
        const read = async (url: string) => {
          const response = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(10_000),
            redirect: "error",
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error("Account lookup failed");
          }
          return response.json();
        };
        // Protocols used by the official Codex ModelsClient and backend-client.
        const [models, limits] = await Promise.allSettled([
          read(
            // Pin the Codex client compatibility version, independently of Dyad's app version.
            "https://chatgpt.com/backend-api/codex/models?client_version=0.154.0",
          ).then((raw) =>
            z
              .object({
                models: z.array(
                  z.object({
                    slug: z.string(),
                    visibility: z.string().optional(),
                  }),
                ),
              })
              .parse(raw)
              .models.filter((m) => m.visibility !== "hide")
              .map((m) => m.slug),
          ),
          read("https://chatgpt.com/backend-api/wham/usage").then(
            parseSubscriptionLimits,
          ),
        ]);
        if (current !== revision) return;
        if (models.status === "fulfilled") {
          cached.models = models.value;
          cached.modelsError = undefined;
        } else {
          cached.modelsError =
            "Subscription model availability is temporarily unavailable.";
        }
        if (limits.status === "fulfilled") {
          Object.assign(cached, limits.value);
          cached.limitsError = undefined;
        } else cached.limitsError = "Usage limits are temporarily unavailable.";
      } catch {
        if (current === revision) {
          cached.error = "Reconnect your ChatGPT subscription to continue.";
          cached.modelsError =
            "Subscription model availability is temporarily unavailable. Reconnect if this persists.";
          cached.limitsError = "Usage limits are temporarily unavailable.";
        }
      } finally {
        if (current === revision) {
          updatedAt = Date.now();
          inflight = undefined;
        }
      }
    })();
  }
  await inflight;
  return { ...getCodexSubscriptionStatus(), ...cached };
}

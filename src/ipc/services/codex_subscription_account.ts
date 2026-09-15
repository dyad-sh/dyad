import { z } from "zod";
import { getBuiltinLanguageModelCatalog } from "../shared/remote_language_model_catalog";
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
const updatedAt = { models: -Infinity, limits: -Infinity };
let revision = 0;
const inflight: Partial<Record<"models" | "limits", Promise<void>>> = {};
export function resetSubscriptionAccount() {
  revision++;
  cached = { models: [], windows: [], limitReached: false };
  updatedAt.models = updatedAt.limits = -Infinity;
  delete inflight.models;
  delete inflight.limits;
}
export function markSubscriptionLimited() {
  cached.limitReached = true;
  updatedAt.limits = -Infinity;
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
// Catalog eligibility and usage display have independent freshness and waiters.
async function refreshAccountPart(part: "models" | "limits") {
  // Retry failed catalog lookups sooner; an outage must not poison eligibility for an hour.
  const ttl = part === "models" && !cached.modelsError ? 60 * 60_000 : 60_000;
  if (!inflight[part] && Date.now() - updatedAt[part] >= ttl) {
    const current = revision;
    inflight[part] = (async () => {
      try {
        const credentials = await getCodexSubscriptionCredentials().catch(
          (error) => {
            if (current === revision && part === "models")
              cached.error = "Reconnect your ChatGPT subscription to continue.";
            throw error;
          },
        );
        if (current !== revision) return;
        if (part === "models") cached.error = undefined;
        const response = await fetch(
          part === "models"
            ? "https://chatgpt.com/backend-api/codex/models?client_version=0.154.0"
            : "https://chatgpt.com/backend-api/wham/usage",
          {
            headers: {
              Authorization: `Bearer ${credentials.access}`,
              "ChatGPT-Account-Id": credentials.accountId,
            },
            signal: AbortSignal.timeout(10_000),
            redirect: "error",
          },
        );
        if (!response.ok) {
          if (
            current === revision &&
            part === "models" &&
            (response.status === 401 || response.status === 403)
          ) {
            cached.error = "Reconnect your ChatGPT subscription to continue.";
          }
          await response.body?.cancel();
          throw new Error("Account lookup failed");
        }
        const raw = await response.json();
        if (current !== revision) return;
        if (part === "models") {
          const models = z
            .object({
              models: z.array(
                z.object({
                  slug: z.string().min(1),
                  visibility: z.string().optional(),
                }),
              ),
            })
            .parse(raw)
            .models.filter((m) => m.visibility !== "hide")
            .map((m) => m.slug);
          // Empty responses must not erase the last successful account catalog.
          if (!models.length)
            throw new Error("Empty subscription model catalog");
          cached.models = models;
          cached.modelsError = undefined;
        } else {
          Object.assign(cached, parseSubscriptionLimits(raw));
          cached.limitsError = undefined;
        }
      } catch {
        if (current !== revision) return;
        if (part === "models") {
          cached.modelsError =
            "Subscription model availability is temporarily unavailable.";
        } else {
          cached.limitsError = "Usage limits are temporarily unavailable.";
        }
      } finally {
        if (current === revision) {
          updatedAt[part] = Date.now();
          delete inflight[part];
        }
      }
    })();
  }
  await inflight[part];
}

export async function getSubscriptionAccount({
  includeUsage = true,
} = {}): Promise<
  ReturnType<typeof getCodexSubscriptionStatus> & typeof cached
> {
  const current = revision;
  const status = getCodexSubscriptionStatus();
  if (!status.connected)
    return { ...status, models: [], windows: [], limitReached: false };
  await Promise.all([
    refreshAccountPart("models"),
    ...(includeUsage ? [refreshAccountPart("limits")] : []),
  ]);
  if (current !== revision) return getSubscriptionAccount({ includeUsage });
  // Both the picker status endpoint and backend routing consume this effective
  // catalog. Keep built-in fallback separate from the last successful ChatGPT
  // result and reuse the built-in catalog's remote/cache/local policy.
  let models = cached.models;
  if (!models.length) {
    const builtinCatalog = await getBuiltinLanguageModelCatalog();
    // A concurrent refresh may have recovered while the built-in lookup waited.
    models = cached.models.length
      ? cached.models
      : (builtinCatalog.modelsByProvider.openai?.map(
          (model) => model.apiName,
        ) ?? []);
  }
  if (current !== revision) return getSubscriptionAccount({ includeUsage });
  return {
    ...getCodexSubscriptionStatus(),
    ...cached,
    models,
    modelsError: models.length ? undefined : cached.modelsError,
  };
}

import log from "electron-log";
import { z } from "zod";
import {
  FALLBACK_CODEX_CLIENT_VERSION,
  getBuiltinLanguageModelCatalog,
  getCodexClientVersion,
} from "../shared/remote_language_model_catalog";
import { queryInvalidationBus } from "@/window_infrastructure/main/query_invalidation_bus";
import {
  getCodexSubscriptionCredentials,
  getCodexSubscriptionStatus,
} from "./codex_subscription_auth";

const logger = log.scope("codex_subscription_account");

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
let requestedModelsClientVersion: string | undefined;
let revision = 0;
const inflight: Partial<Record<"models" | "limits", Promise<void>>> = {};
export function resetSubscriptionAccount() {
  revision++;
  cached = { models: [], windows: [], limitReached: false };
  updatedAt.models = updatedAt.limits = -Infinity;
  requestedModelsClientVersion = undefined;
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
  const activeRevision = revision;
  const clientVersion = part === "models" ? getCodexClientVersion() : undefined;
  // Retry failed catalog lookups sooner; an outage must not poison eligibility for an hour.
  const ttl = part === "models" && !cached.modelsError ? 60 * 60_000 : 60_000;
  if (
    !inflight[part] &&
    (Date.now() - updatedAt[part] >= ttl ||
      (part === "models" && clientVersion !== requestedModelsClientVersion))
  ) {
    const current = revision;
    if (part === "models") requestedModelsClientVersion = clientVersion;
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
        const request = (version: string | undefined) =>
          fetch(
            part === "models"
              ? `https://chatgpt.com/backend-api/codex/models?client_version=${version}`
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
        let response = await request(clientVersion);
        let effectiveClientVersion = clientVersion;
        if (
          part === "models" &&
          current === revision &&
          clientVersion !== FALLBACK_CODEX_CLIENT_VERSION &&
          response.status === 400
        ) {
          await response.body?.cancel();
          logger.warn("Codex model catalog rejected client version", {
            clientVersion,
            fallbackVersion: FALLBACK_CODEX_CLIENT_VERSION,
            status: response.status,
          });
          effectiveClientVersion = FALLBACK_CODEX_CLIENT_VERSION;
          response = await request(effectiveClientVersion);
        }
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
          const modelsChanged =
            models.length !== cached.models.length ||
            models.some((model, index) => model !== cached.models[index]);
          const hadModelsError = cached.modelsError !== undefined;
          cached.models = models;
          cached.modelsError = undefined;
          logger.info("Loaded subscription model catalog", {
            clientVersion: effectiveClientVersion,
            modelCount: models.length,
          });
          if (modelsChanged || hadModelsError) {
            queryInvalidationBus.publish([{ family: "codex-subscription" }]);
          }
        } else {
          Object.assign(cached, parseSubscriptionLimits(raw));
          cached.limitsError = undefined;
        }
      } catch {
        if (current !== revision) return;
        if (part === "models") {
          const hadModelsError = cached.modelsError !== undefined;
          cached.modelsError =
            "Subscription model availability is temporarily unavailable.";
          if (!hadModelsError) {
            queryInvalidationBus.publish([{ family: "codex-subscription" }]);
          }
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
  // A catalog update can land during the account request. Refresh the picker
  // in the background without delaying a successful subscription turn.
  if (
    part === "models" &&
    activeRevision === revision &&
    requestedModelsClientVersion !== getCodexClientVersion()
  ) {
    void refreshAccountPart("models");
  }
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
    modelsError: cached.modelsError,
  };
}

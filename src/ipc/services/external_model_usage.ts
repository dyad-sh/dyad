import { checkSubscriptionCredits } from "./codex_subscription_credit_check";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import log from "electron-log";
import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import { readSettings } from "@/main/settings";
import { isDyadProEnabled } from "@/lib/schemas";
import { getDyadEngineBaseUrl } from "@/ipc/utils/dyad_engine_url";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { SubscriptionTokens } from "@/lib/subscriptionUsage";
import {
  consumeExternalModelAdmission,
  type ExternalModelAdmission,
} from "./external_model_admission";

const logger = log.scope("external_model_usage");
const Count = z.number().int().nonnegative().max(1_000_000_000_000);
const Tokens = z.object({
  input: Count,
  cacheRead: Count,
  cacheWrite: Count,
  output: Count,
});

// Only live requests are tracked. Nothing is persisted or restored on restart.
// Capture the billing account at request start, so a settings change cannot
// redirect an in-flight request's charge to another account.
export interface ExternalModelBilling {
  connection: "subscription" | "local" | "byok";
  modelProvider: string;
}
const active = new Map<
  string,
  { key: string; createdAt: string; billing: ExternalModelBilling }
>();
export async function startExternalModelUsage(
  _model: string,
  signal?: AbortSignal,
  billing: ExternalModelBilling = {
    connection: "subscription",
    modelProvider: "openai",
  },
  apiKey?: string | null,
  admission?: ExternalModelAdmission,
) {
  if (signal?.aborted)
    throw new DyadError(
      "External model request cancelled.",
      DyadErrorKind.UserCancelled,
    );
  // null is an explicitly accepted free request; never consult live settings.
  if (apiKey === null && billing.connection === "subscription")
    return undefined;
  const settings = apiKey === undefined ? readSettings() : undefined;
  // Free subscription requests never check or report Dyad credits. Explicit
  // billing keys still belong to the already-resolved Pro request.
  if (
    billing.connection === "subscription" &&
    settings &&
    !isDyadProEnabled(settings)
  )
    return undefined;
  const key = apiKey ?? settings?.providerSettings?.auto?.apiKey?.value;
  if (!key)
    throw new DyadError(
      "Add your Dyad Pro key before using Pro with an external model.",
      DyadErrorKind.Auth,
    );
  if (!consumeExternalModelAdmission(admission, key))
    await checkSubscriptionCredits(key, signal);
  const id = randomUUID();
  active.set(id, {
    key,
    createdAt: new Date().toISOString(),
    billing: { ...billing },
  });
  return id;
}
export function normalizeExternalModelUsage(
  usage: LanguageModelV3Usage,
): SubscriptionTokens {
  const inputTotal = usage.inputTokens.total;
  const output = usage.outputTokens.total;
  if (inputTotal === undefined || output === undefined)
    throw new Error("External model usage was not reported");
  const cacheRead = usage.inputTokens.cacheRead ?? 0;
  const cacheWrite = usage.inputTokens.cacheWrite ?? 0;
  Count.parse(inputTotal + output);
  return Tokens.parse({
    input: inputTotal - cacheRead - cacheWrite,
    cacheRead,
    cacheWrite,
    output,
  });
}

/** Best effort: consume before sending, never retry or reject into the chat. */
export async function finishExternalModelUsage(
  id: string | undefined,
  model: string,
  usage: LanguageModelV3Usage,
) {
  return finishExternalModelUsageBatch(id, [{ model, usage }]);
}

/** One admitted turn can report several disjoint model buckets (including auxiliary calls). */
export async function finishExternalModelUsageBatch(
  id: string | undefined,
  models: { model: string; usage: LanguageModelV3Usage }[],
) {
  if (!id) return;
  const request = active.get(id);
  if (!request) return;
  active.delete(id);
  await Promise.all(
    models.map(async ({ model, usage }, index) => {
      const reportId = index === 0 ? id : randomUUID();
      try {
        const tokens = normalizeExternalModelUsage(usage);
        const response = await fetch(
          `${getDyadEngineBaseUrl().replace(/\/$/, "")}/track-usage`,
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${request.key}`,
            },
            body: JSON.stringify({
              version: 1,
              id: reportId,
              ...request.billing,
              modelId: model,
              createdAt: request.createdAt,
              totalTokens:
                tokens.input +
                tokens.cacheRead +
                tokens.cacheWrite +
                tokens.output,
              cachedInputTokens: tokens.cacheRead,
              uncachedInputTokens: tokens.input + tokens.cacheWrite,
              outputTokens: tokens.output,
            }),
          },
        );
        if (!response.ok)
          logger.warn("External model usage report failed; not retrying", {
            id,
            status: response.status,
          });
        // No local receipts, queue, or reconciliation. The engine owns account spend.
        await response.body?.cancel();
      } catch {
        // Do not log fetch errors or request objects: they may contain credentials.
        logger.warn(
          "External model usage unavailable or report failed; not retrying",
          { id },
        );
      }
    }),
  );
}
export function interruptExternalModelUsage(
  id: string | undefined,
  notSent = false,
) {
  if (!id) return;
  if (active.delete(id) && !notSent)
    logger.warn("External model request ended without usage; not reporting", {
      id,
    });
}

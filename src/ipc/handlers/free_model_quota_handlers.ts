import fetch from "node-fetch";
import { z } from "zod";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { freeModelQuotaContracts } from "../types/free_model_quota";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { isDyadProEnabled } from "@/lib/schemas";
import { getDyadEngineBaseUrl } from "../utils/dyad_engine_url";

const logger = log.scope("free_model_quota_handlers");

const EngineFreeQuotaResponseSchema = z.object({
  used: z.number(),
  limit: z.number(),
  remaining: z.number(),
  resetAt: z.string(),
});

export function registerFreeModelQuotaHandlers() {
  createTypedHandler(
    freeModelQuotaContracts.getFreeModelQuotaStatus,
    async () => getFreeModelQuotaStatus(),
  );
}

export async function getFreeModelQuotaStatus() {
  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!settings.enableDyadPro || !isDyadProEnabled(settings) || !apiKey) {
    throw new DyadError(
      "Dyad Pro must be enabled to check free model quota.",
      DyadErrorKind.Auth,
    );
  }

  const baseURL = getDyadEngineBaseUrl().replace(/\/$/, "");
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${baseURL}/free/quota`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (error) {
    logger.warn("Failed to fetch free model quota.", error);
    throw new DyadError(
      "Unable to fetch Dyad Free quota.",
      DyadErrorKind.External,
    );
  }

  if (!response.ok) {
    const errorBody = await response.text();
    logger.warn(
      `Failed to fetch free model quota. Status: ${response.status}. Body: ${errorBody}`,
    );
    throw new DyadError(
      "Unable to fetch Dyad Free quota.",
      response.status === 401 || response.status === 403
        ? DyadErrorKind.Auth
        : DyadErrorKind.External,
    );
  }

  const data = EngineFreeQuotaResponseSchema.parse(await response.json());
  const resetTime = new Date(data.resetAt).getTime();

  return {
    messagesUsed: data.used,
    messagesLimit: data.limit,
    messagesRemaining: data.remaining,
    isQuotaExceeded: data.remaining <= 0,
    resetTime: Number.isNaN(resetTime) ? null : resetTime,
  };
}

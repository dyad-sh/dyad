import log from "electron-log";
import { z } from "zod";
import type { LanguageModel } from "@/ipc/types";
import { MODEL_OPTIONS } from "./language_model_constants";

const OpenRouterPricingSchema = z
  .object({
    prompt: z.union([z.number(), z.string()]).nullish(),
    completion: z.union([z.number(), z.string()]).nullish(),
    image: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();

const OpenRouterTopProviderSchema = z
  .object({
    max_completion_tokens: z.number().nullish(),
  })
  .passthrough();

export const OpenRouterModelSchema = z
  .object({
    id: z.string(),
    name: z.string().nullish(),
    description: z.string().nullish(),
    context_length: z.number().nullish(),
    pricing: OpenRouterPricingSchema.nullish(),
    top_provider: OpenRouterTopProviderSchema.nullish(),
  })
  .passthrough();

export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;

const OpenRouterModelsResponseSchema = z
  .object({
    data: z.array(OpenRouterModelSchema),
  })
  .passthrough();

const logger = log.scope("openrouter_free_models");

const DEFAULT_FREE_MODELS: LanguageModel[] = MODEL_OPTIONS.openrouter
  .filter((model) => model.name.endsWith(":free"))
  .map((model) => ({
    apiName: model.name,
    displayName: model.displayName,
    description: model.description ?? "Free OpenRouter model",
    maxOutputTokens: model.maxOutputTokens,
    contextWindow: model.contextWindow,
    temperature: model.temperature,
    dollarSigns: 0,
    tag: "Free",
    type: "cloud",
  }));

let cachedFreeModels: LanguageModel[] = DEFAULT_FREE_MODELS;

const FREE_MODEL_HEADERS = {
  "User-Agent": "Dyad",
  "HTTP-Referer": "https://dyad.sh",
  "X-Title": "Dyad",
};

function normalizePrice(value?: number | string | null) {
  if (value == null) return undefined;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isFreePricing(pricing?: OpenRouterModel["pricing"]) {
  if (!pricing) return false;
  const prompt = normalizePrice(pricing.prompt);
  const completion = normalizePrice(pricing.completion);
  const image = normalizePrice(pricing.image);
  if (prompt == null || completion == null) return false;
  if (prompt !== 0 || completion !== 0) return false;
  return image == null || image === 0;
}

function formatFreeDisplayName(name: string) {
  // Remove "(free)" if present (case-insensitive)
  return name.replace(/\s*\(free\)\s*/gi, "").trim();
}

function sanitizeExternalModelText(value: string | null | undefined) {
  if (value == null) return undefined;

  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildOpenRouterFreeModels(
  models: OpenRouterModel[],
): LanguageModel[] {
  return models
    .filter((model) => isFreePricing(model.pricing))
    .map((model) => {
      const sanitizedName = sanitizeExternalModelText(model.name);
      const sanitizedDescription = sanitizeExternalModelText(model.description);
      const baseName = sanitizedName || model.id;

      return {
        apiName: model.id,
        displayName: formatFreeDisplayName(baseName),
        description: sanitizedDescription || "Free OpenRouter model",
        contextWindow: model.context_length ?? undefined,
        maxOutputTokens: model.top_provider?.max_completion_tokens ?? undefined,
        dollarSigns: 0,
        tag: "Free",
        type: "cloud",
      };
    });
}

export function getOpenRouterFreeModels() {
  return cachedFreeModels;
}

export function getOpenRouterFreeModelNames() {
  return cachedFreeModels.map((model) => model.apiName);
}

export async function hydrateOpenRouterFreeModels() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: FREE_MODEL_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenRouter models request failed: ${response.status}`);
    }

    const payload = await response.json();
    const parseResult = OpenRouterModelsResponseSchema.safeParse(payload);

    if (!parseResult.success) {
      logger.warn("OpenRouter models response had unexpected shape", {
        issues: parseResult.error.issues,
      });
      cachedFreeModels = DEFAULT_FREE_MODELS;
      return;
    }

    const models = parseResult.data.data;
    const freeModels = buildOpenRouterFreeModels(models);

    if (freeModels.length > 0) {
      cachedFreeModels = freeModels;
      logger.info(`Loaded ${freeModels.length} free OpenRouter models.`);
    } else {
      logger.warn("OpenRouter free models response was empty.");
      cachedFreeModels = DEFAULT_FREE_MODELS;
    }
  } catch (error) {
    logger.warn("Failed to load OpenRouter free models", error);
    cachedFreeModels = DEFAULT_FREE_MODELS;
  } finally {
    clearTimeout(timeout);
  }
}

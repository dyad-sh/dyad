import { z } from "zod";

import type { LanguageModel } from "@/ipc/types";

const VERCEL_AI_GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const CACHE_TTL_MS = 15 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 5_000;

const VercelGatewayModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  context_window: z.number().optional(),
  max_tokens: z.number().optional(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  modalities: z
    .object({
      input: z.array(z.string()).optional(),
      output: z.array(z.string()).optional(),
    })
    .optional(),
});

const VercelGatewayModelsResponseSchema = z.object({
  data: z.array(VercelGatewayModelSchema),
});

type VercelGatewayModel = z.infer<typeof VercelGatewayModelSchema>;

let cachedModels: LanguageModel[] | null = null;
let cacheExpiresAt = 0;

function capabilitySummary(model: VercelGatewayModel): string {
  const capabilities = [
    model.type,
    ...(model.tags ?? []),
    ...(model.modalities?.input ?? []).map((value) => `${value} input`),
    ...(model.modalities?.output ?? []).map((value) => `${value} output`),
  ].filter(Boolean);

  return capabilities.length > 0
    ? `Capabilities: ${[...new Set(capabilities)].join(", ")}.`
    : "";
}

export function convertVercelGatewayModel(
  model: VercelGatewayModel,
): LanguageModel {
  const description = [model.description?.trim(), capabilitySummary(model)]
    .filter(Boolean)
    .join(" ");

  return {
    apiName: model.id,
    displayName: model.name?.trim() || model.id,
    description,
    contextWindow: model.context_window,
    maxOutputTokens: model.max_tokens,
    type: "cloud",
  };
}

export async function getVercelAiGatewayModels(): Promise<LanguageModel[]> {
  if (cachedModels && Date.now() < cacheExpiresAt) {
    return cachedModels;
  }

  const response = await fetch(VERCEL_AI_GATEWAY_MODELS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Vercel AI Gateway model catalog returned HTTP ${response.status}.`,
    );
  }

  const parsed = VercelGatewayModelsResponseSchema.parse(await response.json());
  // The app's generic provider client currently uses the OpenAI-compatible
  // language-model surface. Keep non-language media/embedding entries out of
  // the selector until their dedicated execution paths are wired.
  cachedModels = parsed.data
    .filter((model) => !model.type || model.type === "language")
    .map(convertVercelGatewayModel);
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedModels;
}

export function clearVercelAiGatewayModelCacheForTests(): void {
  cachedModels = null;
  cacheExpiresAt = 0;
}

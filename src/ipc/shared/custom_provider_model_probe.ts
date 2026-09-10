import { db } from "@/db";
import {
  language_model_providers,
  language_models,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { LanguageModel } from "@/ipc/types";
import { and, eq } from "drizzle-orm";

const DEFAULT_CUSTOM_PROVIDER_CONTEXT_WINDOW = 128_000;

function normalizeCustomProviderId(providerId: string): string {
  return providerId.startsWith("custom::") ? providerId : `custom::${providerId}`;
}

export type DiscoveredCustomProviderModel = {
  apiName: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  temperature?: number;
  vision?: boolean;
};

function asNumber(value: unknown): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function toJson<T>(payload: Response): Promise<T> {
  return payload.json() as Promise<T>;
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function buildCustomProviderModelDiscoveryUrl(baseUrl: string): string {
  const trimmed = trimBaseUrl(baseUrl);
  if (!trimmed) {
    return "/v1/models";
  }

  try {
    const parsedUrl = new URL(trimmed);
    const pathname = parsedUrl.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/v1")) {
      return `${trimmed}/models`;
    }
    return `${trimmed}/v1/models`;
  } catch {
    return `${trimmed}/v1/models`;
  }
}

function buildOllamaApiUrl(baseUrl: string, path: string): string {
  const trimmed = trimBaseUrl(baseUrl);
  const withoutV1 = trimmed.replace(/\/v1$/, "");
  return `${withoutV1}${path}`;
}

function getModelListFromOpenAICompatiblePayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const modelContainer = payload as { data?: unknown[]; models?: unknown[] };
    if (Array.isArray(modelContainer.data)) {
      return modelContainer.data;
    }
    if (Array.isArray(modelContainer.models)) {
      return modelContainer.models;
    }
  }

  return [];
}

function parseOllamaPsContextLength(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const psPayload = payload as {
    context_length?: unknown;
    models?: Array<{ context_length?: unknown; name?: string }>; 
  };

  const directValue = asNumber(psPayload.context_length);
  if (directValue != null) {
    return directValue;
  }

  const firstModel = psPayload.models?.find((model) => model != null);
  return asNumber(firstModel?.context_length);
}

function parseOllamaShowMetadata(
  payload: unknown,
  modelName: string,
): { contextWindow?: number; temperature?: number; vision?: boolean } {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const showPayload = payload as {
    context_length?: unknown;
    temperature?: unknown;
    model_info?: Record<string, unknown>;
    general?: Record<string, unknown>;
    model?: { context_length?: unknown; temperature?: unknown };
  };

  const nameKey = modelName;
  const modelInfo = showPayload.model_info ?? {};
  const general = showPayload.general ?? {};
  const model = showPayload.model ?? {};

  const contextWindow =
    asNumber(showPayload.context_length) ??
    asNumber(model.context_length) ??
    asNumber(general.context_length) ??
    asNumber(modelInfo.context_length) ??
    asNumber(modelInfo[`${nameKey}.context_length`]);

  const temperature =
    asNumber(showPayload.temperature) ??
    asNumber(model.temperature) ??
    asNumber(general.temperature) ??
    asNumber(modelInfo.temperature);

  const vision =
    Boolean(showPayload.model_info?.vision) ||
    Boolean(showPayload.model_info?.[`vision.${nameKey}`]) ||
    Boolean(general.vision) ||
    Boolean(modelInfo.vision);

  return { contextWindow, temperature, vision };
}

function determineModelContextWindow(
  openAiContextWindow: number | undefined,
  serverContextWindow: number | undefined,
  modelCeiling: number | undefined,
): number | undefined {
  const candidateValues = [
    serverContextWindow,
    modelCeiling,
    openAiContextWindow,
  ].filter((value): value is number => value != null && Number.isFinite(value));

  if (candidateValues.length === 0) {
    return DEFAULT_CUSTOM_PROVIDER_CONTEXT_WINDOW;
  }

  if (candidateValues.length === 1) {
    return candidateValues[0];
  }

  return Math.min(...candidateValues);
}

export function normalizeDiscoveredCustomProviderModels(
  openAiModelsResponse: unknown,
  ollamaPsResponse: unknown | null,
  ollamaShowResponse: unknown | null,
): DiscoveredCustomProviderModel[] {
  const discoveredModels = getModelListFromOpenAICompatiblePayload(
    openAiModelsResponse,
  );

  const serverWindow = parseOllamaPsContextLength(ollamaPsResponse);

  return discoveredModels.map((model) => {
    const item = model as {
      id?: string;
      name?: string;
      model?: string;
      display_name?: string;
      displayName?: string;
      max_model_len?: unknown;
      maxModelLen?: unknown;
      owned_by?: string;
      object?: string;
    };

    const apiName = item.id ?? item.name ?? item.model ?? "";
    const displayName = item.display_name ?? item.displayName ?? apiName;
    const openAiContextWindow =
      asNumber(item.max_model_len) ?? asNumber(item.maxModelLen);

    const ollamaModelWindow =
      ollamaShowResponse != null
        ? parseOllamaShowMetadata(ollamaShowResponse, apiName).contextWindow
        : undefined;

    const effectiveContextWindow = determineModelContextWindow(
      openAiContextWindow,
      serverWindow,
      ollamaModelWindow,
    );

    return {
      apiName,
      displayName,
      description: item.owned_by ? `Owned by ${item.owned_by}` : undefined,
      contextWindow: effectiveContextWindow,
      maxOutputTokens: undefined,
      temperature:
        ollamaShowResponse != null
          ? parseOllamaShowMetadata(ollamaShowResponse, apiName).temperature
          : undefined,
      vision:
        ollamaShowResponse != null
          ? parseOllamaShowMetadata(ollamaShowResponse, apiName).vision
          : undefined,
    };
  });
}

export async function discoverCustomProviderModels(
  apiBaseUrl: string,
): Promise<DiscoveredCustomProviderModel[]> {
  const modelsUrl = buildCustomProviderModelDiscoveryUrl(apiBaseUrl);
  const modelsResponse = await fetch(modelsUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!modelsResponse.ok) {
    throw new DyadError(
      `Failed to discover models for provider at ${apiBaseUrl}: ${modelsResponse.status}`,
      DyadErrorKind.External,
    );
  }

  const modelsPayload = await toJson<unknown>(modelsResponse);
  const discoveredModels = getModelListFromOpenAICompatiblePayload(modelsPayload);

  if (discoveredModels.length === 0) {
    return [];
  }

  const versionUrl = buildOllamaApiUrl(apiBaseUrl, "/api/version");
  const versionResponse = await fetch(versionUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const isOllamaServer = versionResponse.ok;
  let ollamaPsResponse: unknown | null = null;
  let ollamaShowResponse: unknown | null = null;

  if (isOllamaServer) {
    const versionPayload = await toJson<unknown>(versionResponse);
    const isOllama = typeof versionPayload === "object" && versionPayload != null && "version" in versionPayload;
    if (isOllama) {
      const psResponse = await fetch(buildOllamaApiUrl(apiBaseUrl, "/api/ps"), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (psResponse.ok) {
        ollamaPsResponse = await toJson<unknown>(psResponse);
      }

      const firstModelName = (discoveredModels[0] as { id?: string; name?: string; model?: string })?.id ?? (discoveredModels[0] as { id?: string; name?: string; model?: string })?.name ?? (discoveredModels[0] as { id?: string; name?: string; model?: string })?.model;
      if (firstModelName) {
        const showResponse = await fetch(buildOllamaApiUrl(apiBaseUrl, "/api/show"), {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: firstModelName }),
        });
        if (showResponse.ok) {
          ollamaShowResponse = await toJson<unknown>(showResponse);
        }
      }
    }
  }

  return normalizeDiscoveredCustomProviderModels(
    modelsPayload,
    ollamaPsResponse,
    ollamaShowResponse,
  );
}

export async function refreshCustomProviderModels(
  providerId: string,
): Promise<LanguageModel[]> {
  const normalizedProviderId = normalizeCustomProviderId(providerId);

  const provider = db
    .select()
    .from(language_model_providers)
    .where(eq(language_model_providers.id, normalizedProviderId))
    .get();

  if (!provider) {
    throw new DyadError(
      `Provider with ID "${providerId}" not found`,
      DyadErrorKind.NotFound,
    );
  }

  const discoveredModels = await discoverCustomProviderModels(provider.api_base_url);
  const syncedModels: LanguageModel[] = [];

  for (const model of discoveredModels) {
    const modelQuery = db
      .select()
      .from(language_models)
      .where(
        and(
          eq(language_models.customProviderId, normalizedProviderId),
          eq(language_models.apiName, model.apiName),
        ),
      )
      .get();

    if (modelQuery) {
      db.update(language_models)
        .set({
          displayName: model.displayName,
          description: model.description ?? null,
          max_output_tokens: model.maxOutputTokens ?? null,
          context_window:
            model.contextWindow ??
            modelQuery.context_window ??
            DEFAULT_CUSTOM_PROVIDER_CONTEXT_WINDOW,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(language_models.customProviderId, normalizedProviderId),
            eq(language_models.apiName, model.apiName),
          ),
        )
        .run();
    } else {
      const result = db
        .insert(language_models)
        .values({
          displayName: model.displayName,
          apiName: model.apiName,
          customProviderId: normalizedProviderId,
          description: model.description ?? null,
          max_output_tokens: model.maxOutputTokens ?? null,
          context_window:
            model.contextWindow ?? DEFAULT_CUSTOM_PROVIDER_CONTEXT_WINDOW,
        })
        .run();

      syncedModels.push({
        id: Number(result.lastInsertRowid),
        apiName: model.apiName,
        displayName: model.displayName,
        description: model.description,
        maxOutputTokens: model.maxOutputTokens,
        contextWindow: model.contextWindow,
        temperature: model.temperature,
        type: "custom",
      });
      continue;
    }

    syncedModels.push({
      id: modelQuery.id,
      apiName: model.apiName,
      displayName: model.displayName,
      description: model.description,
      maxOutputTokens: model.maxOutputTokens,
      contextWindow:
        model.contextWindow ??
        modelQuery.context_window ??
        DEFAULT_CUSTOM_PROVIDER_CONTEXT_WINDOW,
      temperature: model.temperature,
      type: "custom",
    });
  }

  return syncedModels;
}

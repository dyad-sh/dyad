import { db } from "@/db";
import {
  language_model_providers,
  language_models,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { LanguageModel } from "@/ipc/types";
import { getEnvVar } from "../utils/read_env";
import { and, eq } from "drizzle-orm";

const DEFAULT_CUSTOM_PROVIDER_CONTEXT_WINDOW = 128_000;
const CUSTOM_PROVIDER_PROBE_TIMEOUT_MS = 4_000;

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

function buildCustomProviderRequestHeaders(
  envVarName?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const apiKey = envVarName ? getEnvVar(envVarName)?.trim() : "";
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs = CUSTOM_PROVIDER_PROBE_TIMEOUT_MS,
): Promise<{ response: Response; json: T } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => null)) as T;
    return { response, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
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

function parseOllamaPsContextLengths(
  payload: unknown,
): Record<string, number> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const psPayload = payload as {
    models?: Array<{ context_length?: unknown; name?: string }>;
  };

  const byModel: Record<string, number> = {};
  for (const model of psPayload.models ?? []) {
    if (!model || typeof model.name !== "string") {
      continue;
    }

    const contextLength = asNumber(model.context_length);
    if (contextLength != null) {
      byModel[model.name] = contextLength;
    }
  }

  return byModel;
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

function getOllamaMetadataForModel(
  modelName: string,
  ollamaShowResponse: unknown,
): { contextWindow?: number; temperature?: number; vision?: boolean } {
  if (
    ollamaShowResponse != null &&
    typeof ollamaShowResponse === "object" &&
    !Array.isArray(ollamaShowResponse)
  ) {
    const showResponseMap = ollamaShowResponse as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(showResponseMap, modelName)) {
      const metadata = showResponseMap[modelName];
      if (metadata && typeof metadata === "object") {
        const modelMetadata = metadata as {
          contextWindow?: unknown;
          context_length?: unknown;
          temperature?: unknown;
          vision?: unknown;
        };

        return {
          contextWindow: asNumber(modelMetadata.contextWindow) ??
            asNumber(modelMetadata.context_length),
          temperature: asNumber(modelMetadata.temperature),
          vision: Boolean(modelMetadata.vision),
        };
      }
    }
  }

  return parseOllamaShowMetadata(ollamaShowResponse ?? {}, modelName);
}

export function normalizeDiscoveredCustomProviderModels(
  openAiModelsResponse: unknown,
  ollamaPsResponse: unknown | null,
  ollamaShowResponse: unknown | null,
): DiscoveredCustomProviderModel[] {
  const discoveredModels = getModelListFromOpenAICompatiblePayload(
    openAiModelsResponse,
  );
  const serverWindowsByModel = parseOllamaPsContextLengths(ollamaPsResponse);
  const defaultServerWindow = parseOllamaPsContextLength(ollamaPsResponse);

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
    const modelMetadata =
      ollamaShowResponse != null
        ? getOllamaMetadataForModel(apiName, ollamaShowResponse)
        : {};
    const serverWindow =
      apiName in serverWindowsByModel
        ? serverWindowsByModel[apiName]
        : defaultServerWindow;

    const effectiveContextWindow = determineModelContextWindow(
      openAiContextWindow,
      serverWindow,
      modelMetadata.contextWindow,
    );

    return {
      apiName,
      displayName,
      description: item.owned_by ? `Owned by ${item.owned_by}` : undefined,
      contextWindow: effectiveContextWindow,
      maxOutputTokens: undefined,
      temperature: modelMetadata.temperature,
      vision: modelMetadata.vision,
    };
  });
}

export async function discoverCustomProviderModels(
  apiBaseUrl: string,
  envVarName?: string,
): Promise<DiscoveredCustomProviderModel[]> {
  const modelsUrl = buildCustomProviderModelDiscoveryUrl(apiBaseUrl);
  const requestHeaders = buildCustomProviderRequestHeaders(envVarName);
  const modelsResult = await fetchJsonWithTimeout<unknown>(modelsUrl, {
    method: "GET",
    headers: requestHeaders,
  });

  if (!modelsResult || !modelsResult.response.ok) {
    return [];
  }

  const modelsPayload = modelsResult.json;
  const discoveredModels = getModelListFromOpenAICompatiblePayload(modelsPayload);

  if (discoveredModels.length === 0) {
    return [];
  }

  const versionUrl = buildOllamaApiUrl(apiBaseUrl, "/api/version");
  const versionResult = await fetchJsonWithTimeout<unknown>(versionUrl, {
    method: "GET",
    headers: requestHeaders,
  });

  const isOllamaServer =
    versionResult != null &&
    versionResult.response.ok &&
    typeof versionResult.json === "object" &&
    versionResult.json != null &&
    "version" in versionResult.json;

  let ollamaPsResponse: unknown | null = null;
  const ollamaShowResponsesByModel: Record<string, unknown> = {};

  if (isOllamaServer) {
    const psResult = await fetchJsonWithTimeout<unknown>(
      buildOllamaApiUrl(apiBaseUrl, "/api/ps"),
      {
        method: "GET",
        headers: requestHeaders,
      },
    );
    if (psResult && psResult.response.ok) {
      ollamaPsResponse = psResult.json;
    }

    const modelNames = Array.from(
      new Set(
        discoveredModels
          .map((model) => {
            const item = model as {
              id?: string;
              name?: string;
              model?: string;
            };
            return item.id ?? item.name ?? item.model ?? "";
          })
          .filter((modelName): modelName is string => !!modelName),
      ),
    );

    for (const modelName of modelNames) {
      const showResult = await fetchJsonWithTimeout<unknown>(
        buildOllamaApiUrl(apiBaseUrl, "/api/show"),
        {
          method: "POST",
          headers: {
            ...requestHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: modelName }),
        },
      );

      if (showResult && showResult.response.ok) {
        ollamaShowResponsesByModel[modelName] = showResult.json;
      }
    }
  }

  return normalizeDiscoveredCustomProviderModels(
    modelsPayload,
    ollamaPsResponse,
    ollamaShowResponsesByModel,
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

  const discoveredModels = await discoverCustomProviderModels(
    provider.api_base_url,
    provider.env_var_name ?? undefined,
  );
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

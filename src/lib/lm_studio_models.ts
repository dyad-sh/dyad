import type { LocalModel } from "@/ipc/types/language-model";

export const LM_STUDIO_FETCH_TIMEOUT_MS = 5_000;
const LM_STUDIO_DISCOVERY_CACHE_TTL_MS = 30_000;

const lmStudioDiscoveryCache = new Map<
  string,
  {
    expiresAt: number;
    value: Awaited<ReturnType<typeof discoverLMStudioModels>>;
  }
>();

export interface LMStudioV0Model {
  id: string;
  type: string;
  state?: string;
  [key: string]: unknown;
}

export interface LMStudioV1Model {
  type: string;
  key: string;
  display_name?: string;
  loaded_instances?: { id: string }[];
}

export interface OpenAIModelsListResponse {
  data?: { id: string }[];
}

export type LMStudioDiscoverySource = "openai" | "v1" | "v0";

export function getLMStudioAuthHeaders(): HeadersInit {
  const token = process.env.LM_API_TOKEN?.trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export function parseOpenAICompatibleModels(
  json: OpenAIModelsListResponse,
): LocalModel[] {
  const models: LocalModel[] = [];
  const seen = new Set<string>();

  for (const entry of json.data ?? []) {
    const id = entry.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      modelName: id,
      displayName: id,
      provider: "lmstudio",
    });
  }

  return models;
}

export function parseLMStudioV1Models(
  models: LMStudioV1Model[] | undefined,
): LocalModel[] {
  const loaded = parseLMStudioV1LoadedModels(models);
  if (loaded.length > 0) {
    return loaded;
  }
  return parseLMStudioV1CatalogModels(models);
}

function parseLMStudioV1LoadedModels(
  models: LMStudioV1Model[] | undefined,
): LocalModel[] {
  const result: LocalModel[] = [];
  const seen = new Set<string>();

  for (const model of models ?? []) {
    for (const instance of model.loaded_instances ?? []) {
      const id = instance.id?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push({
        modelName: id,
        displayName: model.display_name ?? id,
        provider: "lmstudio",
      });
    }
  }

  return result;
}

function parseLMStudioV1CatalogModels(
  models: LMStudioV1Model[] | undefined,
): LocalModel[] {
  const result: LocalModel[] = [];
  const seen = new Set<string>();

  for (const model of models ?? []) {
    if (model.type !== "llm" && model.type !== "vlm") continue;
    const key = model.key?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      modelName: key,
      displayName: model.display_name ?? key,
      provider: "lmstudio",
    });
  }

  return result;
}

export function parseLMStudioV0Models(
  models: LMStudioV0Model[] | undefined,
): LocalModel[] {
  const result: LocalModel[] = [];
  const seen = new Set<string>();

  for (const model of models ?? []) {
    const id = model.id?.trim();
    if (!id || seen.has(id)) continue;

    const isChatType = model.type === "llm" || model.type === "vlm";
    const isLoaded = model.state === "loaded";

    if (!isChatType && !isLoaded) continue;

    seen.add(id);
    result.push({
      modelName: id,
      displayName: id,
      provider: "lmstudio",
    });
  }

  return result;
}

export function mergeLocalModels(lists: LocalModel[][]): LocalModel[] {
  const result: LocalModel[] = [];
  const seen = new Set<string>();

  for (const list of lists) {
    for (const model of list) {
      if (seen.has(model.modelName)) continue;
      seen.add(model.modelName);
      result.push(model);
    }
  }

  return result;
}

export interface LMStudioEndpointResult {
  source: LMStudioDiscoverySource;
  models: LocalModel[];
  ok: boolean;
}

export async function fetchLMStudioEndpoint<T>(
  url: string,
  options?: {
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    headers?: HeadersInit;
  },
): Promise<{ ok: true; data: T } | { ok: false }> {
  const fetchFn = options?.fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? LM_STUDIO_FETCH_TIMEOUT_MS;
  const headers = options?.headers ?? getLMStudioAuthHeaders();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Discover models from LM Studio using parallel requests. Prefer OpenAI
 * `/v1/models` (loaded, chat-ready), then native v1, then legacy v0.
 */
export async function discoverLMStudioModels(
  baseUrl: string,
  options?: { fetchFn?: typeof fetch },
): Promise<{
  models: LocalModel[];
  source?: LMStudioDiscoverySource;
  reachable: boolean;
}> {
  const fetchOpts = { fetchFn: options?.fetchFn };

  const [openAiResult, v1Result, v0Result] = await Promise.all([
    fetchLMStudioEndpoint<OpenAIModelsListResponse>(
      `${baseUrl}/v1/models`,
      fetchOpts,
    ),
    fetchLMStudioEndpoint<{ models?: LMStudioV1Model[] }>(
      `${baseUrl}/api/v1/models`,
      fetchOpts,
    ),
    fetchLMStudioEndpoint<{ data?: LMStudioV0Model[] }>(
      `${baseUrl}/api/v0/models`,
      fetchOpts,
    ),
  ]);

  const reachable = openAiResult.ok || v1Result.ok || v0Result.ok;

  if (openAiResult.ok) {
    const models = parseOpenAICompatibleModels(openAiResult.data);
    if (models.length > 0) {
      return { models, source: "openai", reachable };
    }
  }

  if (v1Result.ok) {
    const models = parseLMStudioV1Models(v1Result.data.models);
    if (models.length > 0) {
      return { models, source: "v1", reachable };
    }
  }

  if (v0Result.ok) {
    const models = parseLMStudioV0Models(v0Result.data.data);
    if (models.length > 0) {
      return { models, source: "v0", reachable };
    }
  }

  return { models: [], reachable };
}

/** Cached discovery for chat preflight (avoids hammering LM Studio every message). */
export async function discoverLMStudioModelsCached(
  baseUrl: string,
  options?: { fetchFn?: typeof fetch },
): Promise<Awaited<ReturnType<typeof discoverLMStudioModels>>> {
  const now = Date.now();
  const cached = lmStudioDiscoveryCache.get(baseUrl);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await discoverLMStudioModels(baseUrl, options);
  lmStudioDiscoveryCache.set(baseUrl, {
    expiresAt: now + LM_STUDIO_DISCOVERY_CACHE_TTL_MS,
    value,
  });
  return value;
}

export function clearLMStudioDiscoveryCache(baseUrl?: string): void {
  if (baseUrl) {
    lmStudioDiscoveryCache.delete(baseUrl);
    return;
  }
  lmStudioDiscoveryCache.clear();
}

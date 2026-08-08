/**
 * Turning text into vectors.
 *
 * The built-in hash is lexical: it matches vocabulary, not meaning, so "car"
 * never finds "automobile". That ceiling is fine for grepping documents and
 * useless for memory, which is asked to recall things the user phrased
 * differently months ago. This module puts a real embedding model in front of
 * it and keeps the hash only as the thing that stops a missing Ollama from
 * taking search down with it.
 *
 * Two rules run through everything here.
 *
 * Vectors from different models are not comparable. A collection embedded with
 * `nomic-embed-text` and then topped up with `bge-m3` returns nonsense, quietly,
 * with no error anywhere — so every vector carries the identity of the model
 * that produced it, and a change of model is a rebuild rather than a mix.
 *
 * Detection never scans the network. It checks localhost and hosts the user
 * configured, and nothing else.
 */

import crypto from "node:crypto";
import log from "electron-log";

const logger = log.scope("embedding");

export type EmbeddingProviderId =
  | "auto"
  | "ollama"
  | "openai-compatible"
  | "lexical-fallback";

export type EmbeddingConfig = {
  provider: EmbeddingProviderId;
  model: string;
  endpoint: string;
  apiKey?: string;
  /** Declared dimensions; the health check reports what the model returns. */
  dimensions?: number;
  batchSize: number;
  timeoutMs: number;
  enableFallback: boolean;
};

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  provider: "auto",
  // Small, fast, and widely available. Not hard-coded anywhere but here.
  model: "nomic-embed-text",
  endpoint: "",
  batchSize: 16,
  timeoutMs: 20_000,
  enableFallback: true,
};

/** The lexical fallback's fixed width. */
export const LEXICAL_DIMENSIONS = 384;

export type ResolvedEmbedder = {
  provider: Exclude<EmbeddingProviderId, "auto">;
  model: string;
  dimensions: number;
  /** Identity of the vectors this produces. Changing it invalidates them. */
  version: string;
};

/**
 * The identity a vector is tied to.
 *
 * A content hash alone is not enough: the same text embedded by a different
 * model is a different vector, and reusing the old one would silently corrupt
 * the collection.
 */
export function embeddingVersion(
  provider: string,
  model: string,
  dimensions: number,
): string {
  return `${provider}:${model}:${dimensions}`;
}

/** Bumped when chunking changes shape, since that also invalidates vectors. */
export const CHUNKING_VERSION = "v1";

/** The full identity of a stored vector. */
export function vectorIdentity(input: {
  contentHash: string;
  embeddingVersion: string;
}): string {
  return `${input.contentHash}:${input.embeddingVersion}:${CHUNKING_VERSION}`;
}

export function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// ── Endpoint helpers ───────────────────────────────────────────────────────

/**
 * Hosts we are willing to contact when detecting a provider.
 *
 * Only loopback and whatever the user configured. Probing anything else would
 * be scanning their network.
 */
export function candidateEndpoints(configured: string): string[] {
  const candidates: string[] = [];
  const trimmed = configured.trim();
  if (trimmed) candidates.push(trimmed.replace(/\/+$/, ""));
  candidates.push("http://127.0.0.1:11434", "http://127.0.0.1:1234");
  return [...new Set(candidates)];
}

/** Whether an endpoint is safe to probe without the user naming it. */
export function isLoopback(endpoint: string): boolean {
  try {
    const { hostname } = new URL(endpoint);
    return (
      hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

// ── Lexical fallback ───────────────────────────────────────────────────────

/**
 * The original feature hash, kept as the emergency path.
 *
 * Matches vocabulary only. Good enough to keep search answering when the real
 * provider is unreachable; never good enough to be the default.
 */
export function lexicalEmbed(text: string): number[] {
  const vector = new Float32Array(LEXICAL_DIMENSIONS);
  const normalized = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_./-]+/gu, " ")
    .trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const features = [...tokens];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    features.push(`${tokens[index]}_${tokens[index + 1]}`);
  }
  for (const feature of features) {
    const digest = crypto.createHash("sha256").update(feature).digest();
    const slot = digest.readUInt32LE(0) % LEXICAL_DIMENSIONS;
    const sign = (digest[4]! & 1) === 0 ? 1 : -1;
    vector[slot] += sign;
  }
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return Array.from(vector);
  return Array.from(vector, (value) => value / magnitude);
}

export const LEXICAL_EMBEDDER: ResolvedEmbedder = {
  provider: "lexical-fallback",
  model: "feature-hash",
  dimensions: LEXICAL_DIMENSIONS,
  version: embeddingVersion(
    "lexical-fallback",
    "feature-hash",
    LEXICAL_DIMENSIONS,
  ),
};

// ── Wire formats ───────────────────────────────────────────────────────────

type Fetcher = typeof fetch;

async function postJson<T>(
  url: string,
  body: unknown,
  options: { timeoutMs: number; apiKey?: string; fetcher: Fetcher },
): Promise<T> {
  const response = await options.fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Ollama's native embedding route, which takes a batch directly. */
export async function embedWithOllama(
  texts: string[],
  config: { endpoint: string; model: string; timeoutMs: number },
  fetcher: Fetcher = fetch,
): Promise<number[][]> {
  const payload = await postJson<{ embeddings?: number[][] }>(
    `${config.endpoint.replace(/\/+$/, "")}/api/embed`,
    { model: config.model, input: texts },
    { timeoutMs: config.timeoutMs, fetcher },
  );
  if (!payload.embeddings?.length) {
    throw new Error("no embeddings returned");
  }
  return payload.embeddings;
}

/** The OpenAI shape, which LM Studio and llama.cpp also serve. */
export async function embedWithOpenAiCompatible(
  texts: string[],
  config: {
    endpoint: string;
    model: string;
    timeoutMs: number;
    apiKey?: string;
  },
  fetcher: Fetcher = fetch,
): Promise<number[][]> {
  const base = config.endpoint.replace(/\/+$/, "");
  const url = base.endsWith("/v1")
    ? `${base}/embeddings`
    : `${base}/v1/embeddings`;
  const payload = await postJson<{ data?: { embedding: number[] }[] }>(
    url,
    { model: config.model, input: texts },
    { timeoutMs: config.timeoutMs, apiKey: config.apiKey, fetcher },
  );
  if (!payload.data?.length) {
    throw new Error("no embeddings returned");
  }
  return payload.data.map((entry) => entry.embedding);
}

// ── Detection ──────────────────────────────────────────────────────────────

/**
 * Finds a usable embedder.
 *
 * The health check is a real embedding of a short string, not a version ping:
 * a server can be reachable, and the model present, and still not support
 * embeddings at all. Only a vector coming back proves the path works, and it
 * is also how the true dimension count is learned rather than assumed.
 */
export async function detectEmbedder(
  config: EmbeddingConfig,
  fetcher: Fetcher = fetch,
): Promise<ResolvedEmbedder> {
  const wanted = config.provider;

  if (wanted === "lexical-fallback") return LEXICAL_EMBEDDER;

  const endpoints = candidateEndpoints(config.endpoint).filter(
    (endpoint) => isLoopback(endpoint) || endpoint === config.endpoint.trim(),
  );

  const attempts: {
    provider: Exclude<EmbeddingProviderId, "auto" | "lexical-fallback">;
    endpoint: string;
  }[] = [];

  for (const endpoint of endpoints) {
    if (wanted === "auto" || wanted === "ollama") {
      attempts.push({ provider: "ollama", endpoint });
    }
    if (wanted === "auto" || wanted === "openai-compatible") {
      attempts.push({ provider: "openai-compatible", endpoint });
    }
  }

  for (const attempt of attempts) {
    try {
      const probe =
        attempt.provider === "ollama"
          ? await embedWithOllama(
              ["health check"],
              {
                endpoint: attempt.endpoint,
                model: config.model,
                timeoutMs: Math.min(config.timeoutMs, 5_000),
              },
              fetcher,
            )
          : await embedWithOpenAiCompatible(
              ["health check"],
              {
                endpoint: attempt.endpoint,
                model: config.model,
                timeoutMs: Math.min(config.timeoutMs, 5_000),
                apiKey: config.apiKey,
              },
              fetcher,
            );

      const dimensions = probe[0]?.length ?? 0;
      if (dimensions <= 0) continue;

      logger.log(
        `Embedding via ${attempt.provider} (${config.model}, ${dimensions}d) at ${attempt.endpoint}`,
      );
      return {
        provider: attempt.provider,
        model: config.model,
        dimensions,
        version: embeddingVersion(attempt.provider, config.model, dimensions),
      };
    } catch {
      // Try the next candidate; a provider being absent is normal.
    }
  }

  if (!config.enableFallback && wanted !== "auto") {
    throw new Error(`No embedding provider was reachable for ${config.model}.`);
  }

  logger.warn(
    "No embedding provider reachable; falling back to lexical matching.",
  );
  return LEXICAL_EMBEDDER;
}

// ── Batched embedding ──────────────────────────────────────────────────────

export function batches<T>(items: T[], size: number): T[][] {
  const limit = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += limit) {
    out.push(items.slice(index, index + limit));
  }
  return out;
}

/**
 * Embeds many texts, in batches, with a bounded number of retries.
 *
 * A transient failure retries; an exhausted batch falls back to lexical
 * vectors only when the caller allows it, because silently mixing a lexical
 * vector into a semantic collection would poison every later search.
 */
export async function embedTexts(
  texts: string[],
  embedder: ResolvedEmbedder,
  config: EmbeddingConfig,
  options: {
    fetcher?: Fetcher;
    signal?: { aborted: boolean };
    onProgress?: (done: number, total: number) => void;
    maxAttempts?: number;
  } = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (embedder.provider === "lexical-fallback") {
    return texts.map(lexicalEmbed);
  }

  const fetcher = options.fetcher ?? fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const results: number[][] = [];
  let done = 0;

  for (const batch of batches(texts, config.batchSize)) {
    if (options.signal?.aborted) break;

    let embedded: number[][] | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        embedded =
          embedder.provider === "ollama"
            ? await embedWithOllama(
                batch,
                {
                  endpoint: resolveEndpoint(config),
                  model: embedder.model,
                  timeoutMs: config.timeoutMs,
                },
                fetcher,
              )
            : await embedWithOpenAiCompatible(
                batch,
                {
                  endpoint: resolveEndpoint(config),
                  model: embedder.model,
                  timeoutMs: config.timeoutMs,
                  apiKey: config.apiKey,
                },
                fetcher,
              );
        break;
      } catch (error) {
        if (attempt === maxAttempts) {
          logger.warn(
            `Embedding batch failed after ${maxAttempts} attempts`,
            error,
          );
        } else {
          await delay(200 * 2 ** (attempt - 1));
        }
      }
    }

    if (!embedded) {
      throw new Error("Embedding failed; the collection was left unchanged.");
    }

    // A model returning the wrong width means the collection would be
    // corrupted. Refusing is the only safe answer.
    for (const vector of embedded) {
      if (vector.length !== embedder.dimensions) {
        throw new Error(
          `Embedding returned ${vector.length} dimensions, expected ${embedder.dimensions}.`,
        );
      }
    }

    results.push(...embedded);
    done += batch.length;
    options.onProgress?.(done, texts.length);
  }

  return results;
}

function resolveEndpoint(config: EmbeddingConfig): string {
  const configured = config.endpoint.trim();
  if (configured) return configured;
  return config.provider === "openai-compatible"
    ? "http://127.0.0.1:1234"
    : "http://127.0.0.1:11434";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

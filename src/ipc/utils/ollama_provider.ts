import {
  createOllama,
  type OllamaChatSettings,
  type OllamaProvider,
  type OllamaProviderOptions,
} from "ai-sdk-ollama";
import type { FetchFunction } from "@ai-sdk/provider-utils";

type OllamaChatModelId = string;

export interface DyadOllamaProviderOptions {
  /**
   * Base URL for the Ollama host. For real Ollama, use e.g. http://localhost:11434
   * The Ollama client appends API routes internally.
   * If undefined, defaults to http://localhost:11434
   */
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: FetchFunction;
}

export function createOllamaProvider(
  options?: DyadOllamaProviderOptions,
): OllamaProvider {
  const baseURL = normalizeOllamaBaseURL(options?.baseURL);

  const provider = createOllama({
    baseURL,
    headers: options?.headers,
    fetch: options?.fetch,
  });

  return (modelId: OllamaChatModelId, settings?: OllamaChatSettings) =>
    provider(modelId, settings);
}

// ai-sdk-ollama forwards baseURL to ollama-js as host, so it must remain root-level.
// We strip legacy OpenAI-compatible suffixes (/api or /api/v1) to avoid path duplication.
export function normalizeOllamaBaseURL(baseURL?: string): string {
  const normalizedBaseURL = (baseURL ?? "http://localhost:11434").replace(
    /\/+$/,
    "",
  );

  if (normalizedBaseURL.endsWith("/api/v1")) {
    return normalizedBaseURL.slice(0, -"/api/v1".length);
  }

  if (normalizedBaseURL.endsWith("/api")) {
    return normalizedBaseURL.slice(0, -"/api".length);
  }

  return normalizedBaseURL;
}

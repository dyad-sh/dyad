import { createOllama } from "ai-sdk-ollama";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

type OllamaChatModelId = string;

export interface OllamaProviderOptions {
  /**
   * Base URL for the Ollama API. For real Ollama, use e.g. http://localhost:11434/api
   * The provider will POST to `${baseURL}/chat`.
   * If undefined, defaults to http://localhost:11434/api
   */
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: FetchFunction;
}

export interface OllamaChatSettings {
  options?: {
    num_gpu?: number;
  };
}

export interface OllamaProvider {
  (modelId: OllamaChatModelId, settings?: OllamaChatSettings): LanguageModel;
}

export function createOllamaProvider(
  options?: OllamaProviderOptions,
): OllamaProvider {
  const rawBaseURL = options?.baseURL ?? "http://localhost:11434/api";
  const normalizedBaseURL = rawBaseURL.replace(/\/+$/, "");
  const apiBaseURL = normalizedBaseURL.endsWith("/api")
    ? normalizedBaseURL
    : `${normalizedBaseURL}/api`;

  const provider = createOllama({
    baseURL: apiBaseURL,
    headers: options?.headers,
    fetch: options?.fetch,
  });

  return (modelId: OllamaChatModelId, settings?: OllamaChatSettings) =>
    provider(modelId, settings);
}

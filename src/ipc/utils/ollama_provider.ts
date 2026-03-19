import { createOllama } from "ai-sdk-ollama";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";

type OllamaChatModelId = string;

export interface OllamaProviderOptions {
  /**
   * Base URL for the Ollama host. For real Ollama, use e.g. http://localhost:11434
   * The Ollama client appends API routes internally.
   * If undefined, defaults to http://localhost:11434
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
  // ai-sdk-ollama forwards baseURL to ollama-js as host, so it must remain root-level.
  const baseURL = (options?.baseURL ?? "http://localhost:11434")
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

  const provider = createOllama({
    baseURL,
    headers: options?.headers,
    fetch: options?.fetch,
  });

  return (modelId: OllamaChatModelId, settings?: OllamaChatSettings) =>
    provider(modelId, settings);
}

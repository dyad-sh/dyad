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

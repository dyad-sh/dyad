import { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { withoutTrailingSlash } from "@ai-sdk/provider-utils";
import type {} from "@ai-sdk/provider";

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

export interface OllamaChatSettings {}

export interface OllamaProvider {
  (modelId: OllamaChatModelId, settings?: OllamaChatSettings): LanguageModel;
}

export function createOllamaProvider(
  options?: OllamaProviderOptions,
): OllamaProvider {
  const base = withoutTrailingSlash(
    options?.baseURL ?? "http://localhost:11434",
  )!;
  const v1Base = (base.endsWith("/v1") ? base : `${base}/v1`) as string;
  const provider = createOpenAICompatible({
    name: "ollama",
    baseURL: v1Base,
    headers: options?.headers,
  });
  return (modelId: OllamaChatModelId) => provider(modelId);
}

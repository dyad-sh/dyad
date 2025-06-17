import {
  LanguageModelV1,
  LanguageModelV1ObjectGenerationMode,
} from "@ai-sdk/provider";
import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from "@ai-sdk/provider-utils";

import { OpenAICompatibleChatSettings } from "@ai-sdk/openai-compatible";
import log from "electron-log";
import { getExtraProviderOptions } from "./thinking_utils";

const logger = log.scope("llm_engine_provider");

export type ExampleChatModelId = string & {};

export interface ExampleChatSettings extends OpenAICompatibleChatSettings {
  files?: { path: string; content: string }[];
}
export interface ExampleProviderSettings {
  /**
Example API key.
*/
  apiKey?: string;
  /**
Base URL for the API calls.
*/
  baseURL?: string;
  /**
Custom headers to include in the requests.
*/
  headers?: Record<string, string>;
  /**
Optional custom url query parameters to include in request urls.
*/
  queryParams?: Record<string, string>;
  /**
Custom fetch implementation. You can use it as a middleware to intercept requests,
or to provide a custom fetch implementation for e.g. testing.
*/
  fetch?: FetchFunction;

  originalProviderId: string;
  dyadOptions: {
    enableLazyEdits?: boolean;
    enableSmartFilesContext?: boolean;
  };
}

export interface DyadEngineProvider {
  /**
Creates a model for text generation.
*/
  (
    modelId: ExampleChatModelId,
    settings?: ExampleChatSettings,
  ): LanguageModelV1;

  /**
Creates a chat model for text generation.
*/
  chatModel(
    modelId: ExampleChatModelId,
    settings?: ExampleChatSettings,
  ): LanguageModelV1;
}

export function createDyadEngine(
  options: ExampleProviderSettings,
): DyadEngineProvider {
  const baseURL = withoutTrailingSlash(options.baseURL);
  logger.info("creating dyad engine with baseURL", baseURL);
  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: "DYAD_PRO_API_KEY",
      description: "Example API key",
    })}`,
    ...options.headers,
  });

  interface CommonModelConfig {
    provider: string;
    url: ({ path }: { path: string }) => string;
    headers: () => Record<string, string>;
    fetch?: FetchFunction;
  }

  const getCommonModelConfig = (modelType: string): CommonModelConfig => ({
    provider: `example.${modelType}`,
    url: ({ path }) => {
      const url = new URL(`${baseURL}${path}`);
      if (options.queryParams) {
        url.search = new URLSearchParams(options.queryParams).toString();
      }
      return url.toString();
    },
    headers: getHeaders,
    fetch: options.fetch,
  });

  const createChatModel = (
    modelId: ExampleChatModelId,
    settings: ExampleChatSettings = {},
  ) => {
    // Extract files from settings to process them appropriately
    const { files, ...restSettings } = settings;

    // Create configuration with file handling
    const config = {
      ...getCommonModelConfig("chat"),
      defaultObjectGenerationMode:
        "tool" as LanguageModelV1ObjectGenerationMode,
      // Custom fetch implementation that adds files to the request
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        // Use default fetch if no init or body
        if (!init || !init.body || typeof init.body !== "string") {
          return (options.fetch || fetch)(input, init);
        }

        try {
          // Parse the request body to manipulate it
          const parsedBody = {
            ...JSON.parse(init.body),
            ...getExtraProviderOptions(options.originalProviderId),
          };

          // Add files to the request if they exist
          if (files?.length) {
            parsedBody.dyad_options = {
              files,
              enable_lazy_edits: options.dyadOptions.enableLazyEdits,
              enable_smart_files_context:
                options.dyadOptions.enableSmartFilesContext,
            };
          }

          // Return modified request with files included
          const modifiedInit = {
            ...init,
            body: JSON.stringify(parsedBody),
          };

          // Use the provided fetch or default fetch
          return (options.fetch || fetch)(input, modifiedInit);
        } catch (e) {
          logger.error("Error parsing request body", e);
          // If parsing fails, use original request
          return (options.fetch || fetch)(input, init);
        }
      },
    };

    return new OpenAICompatibleChatLanguageModel(modelId, restSettings, config);
  };

  const provider = (
    modelId: ExampleChatModelId,
    settings?: ExampleChatSettings,
  ) => createChatModel(modelId, settings);

  provider.chatModel = createChatModel;

  return provider;
}

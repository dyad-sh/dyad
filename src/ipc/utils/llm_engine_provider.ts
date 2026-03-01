import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import { OpenAIResponsesLanguageModel } from "@ai-sdk/openai/internal";
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from "@ai-sdk/provider-utils";

import log from "electron-log";
import { getExtraProviderOptions } from "./thinking_utils";
import type { UserSettings } from "../../lib/schemas";
import type { LanguageModel } from "ai";

const logger = log.scope("llm_engine_provider");

export type ExampleChatModelId = string & {};
export interface ChatParams {
  providerId: string;
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

  coneyOptions: {
    enableLazyEdits?: boolean;
    enableSmartFilesContext?: boolean;
    enableWebSearch?: boolean;
  };
  settings: UserSettings;
}

export interface ConeyEngineProvider {
  /**
Creates a model for text generation.
*/
  (modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;

  /**
Creates a chat model for text generation.
*/
  chatModel(modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;

  responses(modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;
}

export function createConeyEngine(
  options: ExampleProviderSettings,
): ConeyEngineProvider {
  const baseURL = withoutTrailingSlash(options.baseURL);
  logger.info("creating coney engine with baseURL", baseURL);

  // Track request ID attempts
  const requestIdAttempts = new Map<string, number>();

  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: "CONEY_PRO_API_KEY",
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

  const getCommonModelConfig = (): CommonModelConfig => ({
    provider: `coney-engine`,
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

  // Custom fetch implementation that adds coney-specific options to the request
  const createConeyFetch = ({
    providerId,
  }: {
    providerId: string;
  }): FetchFunction => {
    return (input: RequestInfo | URL, init?: RequestInit) => {
      // Use default fetch if no init or body
      if (!init || !init.body || typeof init.body !== "string") {
        return (options.fetch || fetch)(input, init);
      }

      try {
        // Parse the request body to manipulate it
        const parsedBody = {
          ...JSON.parse(init.body),
          ...getExtraProviderOptions(providerId, options.settings),
        };
        const coneyVersionedFiles = parsedBody.coneyVersionedFiles;
        if ("coneyVersionedFiles" in parsedBody) {
          delete parsedBody.coneyVersionedFiles;
        }
        const coneyFiles = parsedBody.coneyFiles;
        if ("coneyFiles" in parsedBody) {
          delete parsedBody.coneyFiles;
        }
        const requestId = parsedBody.coneyRequestId;
        if ("coneyRequestId" in parsedBody) {
          delete parsedBody.coneyRequestId;
        }
        const coneyAppId = parsedBody.coneyAppId;
        if ("coneyAppId" in parsedBody) {
          delete parsedBody.coneyAppId;
        }
        const coneyDisableFiles = parsedBody.coneyDisableFiles;
        if ("coneyDisableFiles" in parsedBody) {
          delete parsedBody.coneyDisableFiles;
        }
        const coneyMentionedApps = parsedBody.coneyMentionedApps;
        if ("coneyMentionedApps" in parsedBody) {
          delete parsedBody.coneyMentionedApps;
        }
        const coneySmartContextMode = parsedBody.coneySmartContextMode;
        if ("coneySmartContextMode" in parsedBody) {
          delete parsedBody.coneySmartContextMode;
        }

        // Track and modify requestId with attempt number
        let modifiedRequestId = requestId;
        if (requestId) {
          const currentAttempt = (requestIdAttempts.get(requestId) || 0) + 1;
          requestIdAttempts.set(requestId, currentAttempt);
          modifiedRequestId = `${requestId}:attempt-${currentAttempt}`;
        }

        // Add files to the request if they exist
        if (!coneyDisableFiles) {
          parsedBody.coney_options = {
            files: coneyFiles,
            versioned_files: coneyVersionedFiles,
            enable_lazy_edits: options.coneyOptions.enableLazyEdits,
            enable_smart_files_context:
              options.coneyOptions.enableSmartFilesContext,
            smart_context_mode: coneySmartContextMode,
            enable_web_search: options.coneyOptions.enableWebSearch,
            app_id: coneyAppId,
          };
          if (coneyMentionedApps?.length) {
            parsedBody.coney_options.mentioned_apps = coneyMentionedApps;
          }
        }

        // Return modified request with files included and requestId in headers
        const modifiedInit = {
          ...init,
          headers: {
            ...init.headers,
            ...(modifiedRequestId && {
              "X-Coney-Request-Id": modifiedRequestId,
            }),
          },
          body: JSON.stringify(parsedBody),
        };

        // Use the provided fetch or default fetch
        return (options.fetch || fetch)(input, modifiedInit);
      } catch (e) {
        logger.error("Error parsing request body", e);
        // If parsing fails, use original request
        return (options.fetch || fetch)(input, init);
      }
    };
  };

  const createChatModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ) => {
    const config = {
      ...getCommonModelConfig(),
      fetch: createConeyFetch({ providerId: chatParams.providerId }),
    };

    return new OpenAICompatibleChatLanguageModel(modelId, config);
  };

  const createResponsesModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ) => {
    const config = {
      ...getCommonModelConfig(),
      fetch: createConeyFetch({ providerId: chatParams.providerId }),
    };

    return new OpenAIResponsesLanguageModel(modelId, config);
  };

  const provider = (modelId: ExampleChatModelId, chatParams: ChatParams) =>
    createChatModel(modelId, chatParams);

  provider.chatModel = createChatModel;
  provider.responses = createResponsesModel;

  return provider;
}

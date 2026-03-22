import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from "@ai-sdk/provider-utils";

import log from "electron-log";
import { getExtraProviderOptions } from "./thinking_utils";
import type { UserSettings } from "../../lib/schemas";
import { LanguageModelV2 } from "@ai-sdk/provider";

const logger = log.scope("llm_engine_provider");

export type ExampleChatModelId = string & {};
export interface ExampleChatSettings {}
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
  joyOptions: {
    enableLazyEdits?: boolean;
    enableSmartFilesContext?: boolean;
    enableWebSearch?: boolean;
  };
  settings: UserSettings;
}

export interface JoyEngineProvider {
  /**
Creates a model for text generation.
*/
  (
    modelId: ExampleChatModelId,
    settings?: ExampleChatSettings,
  ): LanguageModelV2;

  /**
Creates a chat model for text generation.
*/
  chatModel(
    modelId: ExampleChatModelId,
    settings?: ExampleChatSettings,
  ): LanguageModelV2;
}

export function createJoyEngine(
  options: ExampleProviderSettings,
): JoyEngineProvider {
  const baseURL = withoutTrailingSlash(options.baseURL);
  logger.info("creating joy engine with baseURL", baseURL);

  // Track request ID attempts
  const requestIdAttempts = new Map<string, number>();

  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: "JOY_API_KEY",
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
    provider: `joy-engine`,
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

  const createChatModel = (modelId: ExampleChatModelId) => {
    // Create configuration with file handling
    const config = {
      ...getCommonModelConfig(),
      // defaultObjectGenerationMode:
      //   "tool" as LanguageModelV1ObjectGenerationMode,
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
            ...getExtraProviderOptions(
              options.originalProviderId,
              options.settings,
            ),
          };
          const joyVersionedFiles = parsedBody.joyVersionedFiles;
          if ("joyVersionedFiles" in parsedBody) {
            delete parsedBody.joyVersionedFiles;
          }
          const joyFiles = parsedBody.joyFiles;
          if ("joyFiles" in parsedBody) {
            delete parsedBody.joyFiles;
          }
          const requestId = parsedBody.joyRequestId;
          if ("joyRequestId" in parsedBody) {
            delete parsedBody.joyRequestId;
          }
          const joyAppId = parsedBody.joyAppId;
          if ("joyAppId" in parsedBody) {
            delete parsedBody.joyAppId;
          }
          const joyDisableFiles = parsedBody.joyDisableFiles;
          if ("joyDisableFiles" in parsedBody) {
            delete parsedBody.joyDisableFiles;
          }
          const joyMentionedApps = parsedBody.joyMentionedApps;
          if ("joyMentionedApps" in parsedBody) {
            delete parsedBody.joyMentionedApps;
          }
          const joySmartContextMode = parsedBody.joySmartContextMode;
          if ("joySmartContextMode" in parsedBody) {
            delete parsedBody.joySmartContextMode;
          }

          // Track and modify requestId with attempt number
          let modifiedRequestId = requestId;
          if (requestId) {
            const currentAttempt = (requestIdAttempts.get(requestId) || 0) + 1;
            requestIdAttempts.set(requestId, currentAttempt);
            modifiedRequestId = `${requestId}:attempt-${currentAttempt}`;
          }

          // Add files to the request if they exist
          if (!joyDisableFiles) {
            parsedBody.joy_options = {
              files: joyFiles,
              versioned_files: joyVersionedFiles,
              enable_lazy_edits: options.joyOptions.enableLazyEdits,
              enable_smart_files_context:
                options.joyOptions.enableSmartFilesContext,
              smart_context_mode: joySmartContextMode,
              enable_web_search: options.joyOptions.enableWebSearch,
              app_id: joyAppId,
            };
            if (joyMentionedApps?.length) {
              parsedBody.joy_options.mentioned_apps = joyMentionedApps;
            }
          }

          // Return modified request with files included and requestId in headers
          const modifiedInit = {
            ...init,
            headers: {
              ...init.headers,
              ...(modifiedRequestId && {
                "X-Joy-Request-Id": modifiedRequestId,
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
      },
    };

    return new OpenAICompatibleChatLanguageModel(modelId, config as any);
  };

  const provider = (modelId: ExampleChatModelId) => createChatModel(modelId);

  provider.chatModel = createChatModel;

  return provider;
}

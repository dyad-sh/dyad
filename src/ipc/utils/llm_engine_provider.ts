import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import { OpenAIResponsesLanguageModel } from "@ai-sdk/openai/internal";
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from "@ai-sdk/provider-utils";

import log from "electron-log";
import { getExtraProviderOptions } from "./thinking_utils";
import { PROTEAAI_INTERNAL_REQUEST_ID_HEADER } from "./provider_options";
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

  dyadOptions: {
    enableLazyEdits?: boolean;
    enableSmartFilesContext?: boolean;
    enableWebSearch?: boolean;
  };
  settings: UserSettings;
}

export interface ProteaAIEngineProvider {
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

export function createProteaAIEngine(
  options: ExampleProviderSettings,
): ProteaAIEngineProvider {
  const baseURL = withoutTrailingSlash(options.baseURL);
  logger.info("creating dyad engine with baseURL", baseURL);

  // Track request ID attempts
  const requestIdAttempts = new Map<string, number>();

  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: "PROTEAAI_PRO_API_KEY",
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
    provider: `dyad-engine`,
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

  // Custom fetch implementation that adds dyad-specific options to the request
  const createProteaAIFetch = ({
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

        const proteaaiVersionedFiles = parsedBody.proteaaiVersionedFiles;
        if ("proteaaiVersionedFiles" in parsedBody) {
          delete parsedBody.proteaaiVersionedFiles;
        }
        const proteaaiFiles = parsedBody.proteaaiFiles;
        if ("proteaaiFiles" in parsedBody) {
          delete parsedBody.proteaaiFiles;
        }
        // Read from body (OpenAICompatible models spread providerOptions into
        // the body) with a fallback to an internal header (OpenAIResponses
        // models don't forward providerOptions, so we pass it via header).
        const requestId =
          parsedBody.proteaaiRequestId ??
          (init.headers as Record<string, string> | undefined)?.[
            PROTEAAI_INTERNAL_REQUEST_ID_HEADER
          ];
        if ("proteaaiRequestId" in parsedBody) {
          delete parsedBody.proteaaiRequestId;
        }
        const proteaaiAppId = parsedBody.proteaaiAppId;
        if ("proteaaiAppId" in parsedBody) {
          delete parsedBody.proteaaiAppId;
        }
        const proteaaiDisableFiles = parsedBody.proteaaiDisableFiles;
        if ("proteaaiDisableFiles" in parsedBody) {
          delete parsedBody.proteaaiDisableFiles;
        }
        const proteaaiMentionedApps = parsedBody.proteaaiMentionedApps;
        if ("proteaaiMentionedApps" in parsedBody) {
          delete parsedBody.proteaaiMentionedApps;
        }
        const proteaaiSmartContextMode = parsedBody.proteaaiSmartContextMode;
        if ("proteaaiSmartContextMode" in parsedBody) {
          delete parsedBody.proteaaiSmartContextMode;
        }

        // Track and modify requestId with attempt number
        let modifiedRequestId = requestId;
        if (requestId) {
          const currentAttempt = (requestIdAttempts.get(requestId) || 0) + 1;
          requestIdAttempts.set(requestId, currentAttempt);
          modifiedRequestId = `${requestId}:attempt-${currentAttempt}`;
        }

        // Add files to the request if they exist
        if (!proteaaiDisableFiles) {
          parsedBody.dyad_options = {
            files: proteaaiFiles,
            versioned_files: proteaaiVersionedFiles,
            enable_lazy_edits: options.dyadOptions.enableLazyEdits,
            enable_smart_files_context:
              options.dyadOptions.enableSmartFilesContext,
            smart_context_mode: proteaaiSmartContextMode,
            enable_web_search: options.dyadOptions.enableWebSearch,
            app_id: proteaaiAppId,
          };
          if (proteaaiMentionedApps?.length) {
            parsedBody.dyad_options.mentioned_apps = proteaaiMentionedApps;
          }
        }

        // Return modified request with files included and requestId in headers
        const { [PROTEAAI_INTERNAL_REQUEST_ID_HEADER]: _, ...outgoingHeaders } =
          (init.headers as Record<string, string>) ?? {};
        const modifiedInit = {
          ...init,
          headers: {
            ...outgoingHeaders,
            ...(modifiedRequestId && {
              "X-ProteaAI-Request-Id": modifiedRequestId,
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
      fetch: createProteaAIFetch({ providerId: chatParams.providerId }),
    };

    return new OpenAICompatibleChatLanguageModel(modelId, config);
  };

  const createResponsesModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ) => {
    const config = {
      ...getCommonModelConfig(),
      fetch: createProteaAIFetch({ providerId: chatParams.providerId }),
    };

    return new OpenAIResponsesLanguageModel(modelId, config);
  };

  const provider = (modelId: ExampleChatModelId, chatParams: ChatParams) =>
    createChatModel(modelId, chatParams);

  provider.chatModel = createChatModel;
  provider.responses = createResponsesModel;

  return provider;
}

export async function transcribeWithProteaAIEngine(
  audioBuffer: Buffer,
  filename: string,
  requestId: string,
  options: ExampleProviderSettings,
): Promise<string> {
  const baseURL = withoutTrailingSlash(options.baseURL);
  const apiKey = loadApiKey({
    apiKey: options.apiKey,
    environmentVariableName: "PROTEAAI_PRO_API_KEY",
    description: "ProteaAI Pro API key",
  });
  logger.info("transcribing with dyad engine with baseURL", baseURL);

  const formData = new FormData();
  const mimeType = filename.endsWith(".webm")
    ? "audio/webm"
    : filename.endsWith(".mp3")
      ? "audio/mpeg"
      : filename.endsWith(".wav")
        ? "audio/wav"
        : filename.endsWith(".m4a")
          ? "audio/mp4"
          : "audio/webm";
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  formData.append("file", blob, filename);
  formData.append("model", "gpt-4o-mini-transcribe");

  const fetchFn = options.fetch || fetch;
  const response = await fetchFn(`${baseURL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-ProteaAI-Request-Id": requestId,
      ...options.headers,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ProteaAI Engine transcription failed: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }
  const data = (await response.json()) as { text: string };
  return data.text;
}

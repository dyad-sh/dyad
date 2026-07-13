import { OpenAICompatibleChatLanguageModel } from "@ai-sdk/openai-compatible";
import { OpenAIResponsesLanguageModel } from "@ai-sdk/openai/internal";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  FetchFunction,
  loadApiKey,
  withoutTrailingSlash,
} from "@ai-sdk/provider-utils";

import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getExtraProviderOptionsForEngine } from "./thinking_utils";
import { getTestFetchOption } from "./test_fetch_override";
import { DYAD_INTERNAL_REQUEST_ID_HEADER } from "./provider_options";
import type { UserSettings } from "../../lib/schemas";
import type { LanguageModel } from "ai";
import {
  findInvalidProviderApiKeyCharacter,
  formatInvalidProviderApiKeyMessage,
  normalizeProviderApiKeyInput,
} from "@/lib/providerApiKey";

const logger = log.scope("llm_engine_provider");

export type ExampleChatModelId = string & {};
export interface ChatParams {
  providerId: string;
}

type DyadEngineProviderOptions = Record<string, any>;

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

export interface DyadEngineProvider {
  /**
Creates a model for text generation.
*/
  (modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;

  /**
Creates a chat model for text generation.
*/
  chatModel(modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;

  freeChatModel(
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ): LanguageModel;

  responses(modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;

  anthropic(modelId: ExampleChatModelId, chatParams: ChatParams): LanguageModel;
}

export function createDyadEngine(
  options: ExampleProviderSettings,
): DyadEngineProvider {
  const baseURL = withoutTrailingSlash(options.baseURL);
  logger.debug("creating dyad engine with baseURL", baseURL);

  // Track request ID attempts
  const requestIdAttempts = new Map<string, number>();

  const getHeaders = () => ({
    Authorization: `Bearer ${getDyadEngineApiKey(options.apiKey)}`,
    ...options.headers,
  });

  interface CommonModelConfig {
    provider: string;
    url: ({ path }: { path: string }) => string;
    headers: () => Record<string, string>;
    fetch?: FetchFunction;
  }

  const getCommonModelConfig = (pathPrefix = ""): CommonModelConfig => ({
    provider: `dyad-engine`,
    url: ({ path }) => {
      const url = new URL(`${baseURL}${pathPrefix}${path}`);
      if (options.queryParams) {
        url.search = new URLSearchParams(options.queryParams).toString();
      }
      return url.toString();
    },
    headers: getHeaders,
    fetch: options.fetch,
  });

  const appendQueryParams = (input: RequestInfo | URL): RequestInfo | URL => {
    if (!options.queryParams) {
      return input;
    }

    const appendToUrl = (urlValue: string) => {
      const url = new URL(urlValue);
      for (const [key, value] of Object.entries(options.queryParams ?? {})) {
        url.searchParams.set(key, value);
      }
      return url.toString();
    };

    if (typeof input === "string") {
      return appendToUrl(input);
    }
    if (input instanceof URL) {
      return new URL(appendToUrl(input.toString()));
    }
    if (input instanceof Request) {
      return new Request(appendToUrl(input.url), input);
    }
    return input;
  };

  // Custom fetch implementation that adds dyad-specific options to the request
  const createDyadFetch = ({
    providerId,
    dyadProviderOptions,
    disableDyadOptions = false,
    includeFreeQuotaKey = false,
  }: {
    providerId: string;
    dyadProviderOptions?: DyadEngineProviderOptions;
    disableDyadOptions?: boolean;
    includeFreeQuotaKey?: boolean;
  }): FetchFunction => {
    return (input: RequestInfo | URL, init?: RequestInit) => {
      const requestInput = appendQueryParams(input);

      // Use default fetch if no init or body
      if (!init || !init.body || typeof init.body !== "string") {
        return (options.fetch || fetch)(requestInput, init);
      }

      try {
        // Parse the request body to manipulate it
        const parsedBody = {
          ...JSON.parse(init.body),
          ...getExtraProviderOptionsForEngine(providerId, options.settings),
        };

        const getDyadOption = (key: string) =>
          key in parsedBody ? parsedBody[key] : dyadProviderOptions?.[key];

        const dyadVersionedFiles = getDyadOption("dyadVersionedFiles");
        if ("dyadVersionedFiles" in parsedBody) {
          delete parsedBody.dyadVersionedFiles;
        }
        const dyadFiles = getDyadOption("dyadFiles");
        if ("dyadFiles" in parsedBody) {
          delete parsedBody.dyadFiles;
        }
        // Read from body (OpenAICompatible models spread providerOptions into
        // the body) with a fallback to an internal header (OpenAIResponses
        // models don't forward providerOptions, so we pass it via header).
        const requestId =
          getDyadOption("dyadRequestId") ??
          (init.headers as Record<string, string> | undefined)?.[
            DYAD_INTERNAL_REQUEST_ID_HEADER
          ];
        if ("dyadRequestId" in parsedBody) {
          delete parsedBody.dyadRequestId;
        }
        const dyadAppId = getDyadOption("dyadAppId");
        if ("dyadAppId" in parsedBody) {
          delete parsedBody.dyadAppId;
        }
        const dyadDisableFiles =
          disableDyadOptions || getDyadOption("dyadDisableFiles");
        if ("dyadDisableFiles" in parsedBody) {
          delete parsedBody.dyadDisableFiles;
        }
        const dyadMentionedApps = getDyadOption("dyadMentionedApps");
        if ("dyadMentionedApps" in parsedBody) {
          delete parsedBody.dyadMentionedApps;
        }
        const dyadSmartContextMode = getDyadOption("dyadSmartContextMode");
        if ("dyadSmartContextMode" in parsedBody) {
          delete parsedBody.dyadSmartContextMode;
        }

        // Track and modify requestId with attempt number
        let modifiedRequestId = requestId;
        if (requestId) {
          const currentAttempt = (requestIdAttempts.get(requestId) || 0) + 1;
          requestIdAttempts.set(requestId, currentAttempt);
          modifiedRequestId = `${requestId}:attempt-${currentAttempt}`;
        }

        // Add files to the request if they exist
        if (!dyadDisableFiles) {
          parsedBody.dyad_options = {
            files: dyadFiles,
            versioned_files: dyadVersionedFiles,
            enable_lazy_edits: options.dyadOptions.enableLazyEdits,
            enable_smart_files_context:
              options.dyadOptions.enableSmartFilesContext,
            smart_context_mode: dyadSmartContextMode,
            enable_web_search: options.dyadOptions.enableWebSearch,
            app_id: dyadAppId,
          };
          if (dyadMentionedApps?.length) {
            parsedBody.dyad_options.mentioned_apps = dyadMentionedApps;
          }
        }

        // Return modified request with files included and requestId in headers
        const { [DYAD_INTERNAL_REQUEST_ID_HEADER]: _, ...outgoingHeaders } =
          (init.headers as Record<string, string>) ?? {};
        const modifiedInit = {
          ...init,
          headers: {
            ...outgoingHeaders,
            ...(modifiedRequestId && {
              "X-Dyad-Request-Id": modifiedRequestId,
            }),
            ...(includeFreeQuotaKey &&
              requestId && {
                "X-Dyad-Free-Quota-Key": requestId,
              }),
          },
          body: JSON.stringify(parsedBody),
        };

        // Use the provided fetch or default fetch
        return (options.fetch || fetch)(requestInput, modifiedInit);
      } catch (e) {
        logger.error("Error parsing request body", e);
        // If parsing fails, use original request
        return (options.fetch || fetch)(requestInput, init);
      }
    };
  };

  const createChatModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
    pathPrefix = "",
  ) => {
    const config = {
      ...getCommonModelConfig(pathPrefix),
      fetch: createDyadFetch({
        providerId: chatParams.providerId,
        disableDyadOptions: pathPrefix === "/free",
        includeFreeQuotaKey: pathPrefix === "/free",
      }),
    };

    return new OpenAICompatibleChatLanguageModel(modelId, config);
  };

  const createFreeChatModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ) => createChatModel(modelId, chatParams, "/free");

  const createResponsesModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ) => {
    const config = {
      ...getCommonModelConfig(),
      fetch: createDyadFetch({ providerId: chatParams.providerId }),
    };

    return new OpenAIResponsesLanguageModel(modelId, config);
  };

  const createAnthropicModel = (
    modelId: ExampleChatModelId,
    chatParams: ChatParams,
  ) => {
    const createModel = (dyadProviderOptions?: DyadEngineProviderOptions) => {
      const provider = createAnthropic({
        authToken: getDyadEngineApiKey(options.apiKey),
        baseURL,
        headers: options.headers,
        fetch: createDyadFetch({
          providerId: chatParams.providerId,
          dyadProviderOptions,
        }),
        name: "dyad-engine",
      });

      return provider(modelId);
    };
    const model = createModel();
    const getDyadProviderOptions = (callOptions: {
      providerOptions?: Record<string, unknown>;
    }) =>
      callOptions.providerOptions?.["dyad-engine"] as
        | DyadEngineProviderOptions
        | undefined;

    const wrappedModel = {
      specificationVersion: model.specificationVersion,
      provider: model.provider,
      modelId: model.modelId,
      supportedUrls: model.supportedUrls,
      doGenerate: (callOptions) =>
        createModel(getDyadProviderOptions(callOptions)).doGenerate(
          callOptions,
        ),
      doStream: (callOptions) =>
        createModel(getDyadProviderOptions(callOptions)).doStream(callOptions),
    } satisfies LanguageModel;

    const defaultObjectGenerationMode = (
      model as LanguageModel & { defaultObjectGenerationMode?: unknown }
    ).defaultObjectGenerationMode;
    if (defaultObjectGenerationMode !== undefined) {
      Object.assign(wrappedModel, { defaultObjectGenerationMode });
    }

    return wrappedModel;
  };

  const provider = (modelId: ExampleChatModelId, chatParams: ChatParams) =>
    createChatModel(modelId, chatParams);

  provider.chatModel = createChatModel;
  provider.freeChatModel = createFreeChatModel;
  provider.responses = createResponsesModel;
  provider.anthropic = createAnthropicModel;

  return provider;
}

export async function transcribeWithDyadEngine(
  audioBuffer: Buffer,
  filename: string,
  requestId: string,
  options: ExampleProviderSettings,
): Promise<string> {
  const baseURL = withoutTrailingSlash(options.baseURL);
  const apiKey = getDyadEngineApiKey(options.apiKey);
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
  const audioBytes = new Uint8Array(
    audioBuffer.buffer as ArrayBuffer,
    audioBuffer.byteOffset,
    audioBuffer.byteLength,
  );
  const blob = new Blob([audioBytes], { type: mimeType });
  formData.append("file", blob, filename);
  formData.append("model", "gpt-4o-mini-transcribe");

  const fetchFn = options.fetch || getTestFetchOption().fetch || fetch;
  const response = await fetchFn(`${baseURL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Dyad-Request-Id": requestId,
      ...options.headers,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new DyadError(
      `Dyad Engine transcription failed: ${response.status} ${response.statusText} - ${errorText}`,
      DyadErrorKind.External,
    );
  }
  const data = (await response.json()) as { text: string };
  return data.text;
}

function getDyadEngineApiKey(apiKey: string | undefined): string {
  const loadedApiKey = loadApiKey({
    apiKey,
    environmentVariableName: "DYAD_PRO_API_KEY",
    description: "Dyad Pro API key",
  });
  const normalizedApiKey = normalizeProviderApiKeyInput(loadedApiKey);
  const invalidCharacter = findInvalidProviderApiKeyCharacter(normalizedApiKey);
  if (invalidCharacter) {
    throw new DyadError(
      formatInvalidProviderApiKeyMessage("Dyad", invalidCharacter),
      DyadErrorKind.Validation,
    );
  }
  return normalizedApiKey;
}

import type { SmartContextMode, UserSettings } from "../../lib/schemas";
import type { CodebaseFile } from "../../utils/codebase";
import type { VersionedFiles } from "./versioned_codebase_context";
import { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { getExtraProviderOptions } from "./thinking_utils";

export interface MentionedAppCodebase {
  appName: string;
  files: CodebaseFile[];
}

export interface GetProviderOptionsParams {
  proteaaiAppId: number;
  proteaaiRequestId?: string;
  proteaaiDisableFiles?: boolean;
  smartContextMode?: SmartContextMode;
  files: CodebaseFile[];
  versionedFiles?: VersionedFiles;
  mentionedAppsCodebases: MentionedAppCodebase[];
  builtinProviderId: string | undefined;
  settings: UserSettings;
}

/**
 * Builds provider options for the AI SDK streamText call.
 * Handles provider-specific configuration including thinking configs for Google/Vertex.
 */
export function getProviderOptions({
  proteaaiAppId,
  proteaaiRequestId,
  proteaaiDisableFiles,
  smartContextMode,
  files,
  versionedFiles,
  mentionedAppsCodebases,
  builtinProviderId,
  settings,
}: GetProviderOptionsParams): Record<string, any> {
  const providerOptions: Record<string, any> = {
    "proteaai-engine": {
      proteaaiAppId,
      proteaaiRequestId,
      proteaaiDisableFiles,
      proteaaiSmartContextMode: smartContextMode,
      proteaaiFiles: versionedFiles ? undefined : files,
      proteaaiVersionedFiles: versionedFiles,
      proteaaiMentionedApps: mentionedAppsCodebases.map(({ files, appName }) => ({
        appName,
        files,
      })),
    },
    "proteaai-gateway": getExtraProviderOptions(builtinProviderId, settings),
    openai: {
      reasoningSummary: "auto",
    } satisfies OpenAIResponsesProviderOptions,
  };

  // Conditionally include Google thinking config only for supported models
  const selectedModelName = settings.selectedModel.name || "";
  const providerId = builtinProviderId;
  const isVertex = providerId === "vertex";
  const isGoogle = providerId === "google";
  const isPartnerModel = selectedModelName.includes("/");
  const isGeminiModel = selectedModelName.startsWith("gemini");
  const isFlashLite = selectedModelName.includes("flash-lite");

  // Keep Google provider behavior unchanged: always include includeThoughts
  if (isGoogle) {
    providerOptions.google = {
      thinkingConfig: {
        includeThoughts: true,
      },
    } satisfies GoogleGenerativeAIProviderOptions;
  }

  // Vertex-specific fix: only enable thinking on supported Gemini models
  if (isVertex && isGeminiModel && !isFlashLite && !isPartnerModel) {
    providerOptions.google = {
      thinkingConfig: {
        includeThoughts: true,
      },
    } satisfies GoogleGenerativeAIProviderOptions;
  }

  return providerOptions;
}

// Header used to pass the request ID through AI SDK models that don't forward
// providerOptions into the request body (e.g. OpenAIResponsesLanguageModel).
export const PROTEAAI_INTERNAL_REQUEST_ID_HEADER =
  "x-dyad-internal-request-id" as const;

export interface GetAiHeadersParams {
  builtinProviderId: string | undefined;
}

/**
 * Returns extra AI request headers for the provider (e.g. beta flags).
 * Currently none; reserved for future provider-specific headers.
 */
export function getAiHeaders(
  _params: GetAiHeadersParams,
): Record<string, string> | undefined {
  return undefined;
}

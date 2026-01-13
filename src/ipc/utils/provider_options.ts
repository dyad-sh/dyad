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
  dyadAppId: number;
  dyadRequestId?: string;
  dyadDisableFiles?: boolean;
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
  dyadAppId,
  dyadRequestId,
  dyadDisableFiles,
  smartContextMode,
  files,
  versionedFiles,
  mentionedAppsCodebases,
  builtinProviderId,
  settings,
}: GetProviderOptionsParams): Record<string, any> {
  const providerOptions: Record<string, any> = {
    "dyad-engine": {
      dyadAppId,
      dyadRequestId,
      dyadDisableFiles,
      dyadSmartContextMode: smartContextMode,
      dyadFiles: versionedFiles ? undefined : files,
      dyadVersionedFiles: versionedFiles,
      dyadMentionedApps: mentionedAppsCodebases.map(({ files, appName }) => ({
        appName,
        files,
      })),
    },
    "dyad-gateway": getExtraProviderOptions(builtinProviderId, settings),
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

export interface GetAiHeadersParams {
  builtinProviderId: string | undefined;
}

/**
 * Returns AI request headers based on the provider.
 * Currently adds Anthropic-specific beta header for extended context.
 */
export function getAiHeaders({
  builtinProviderId,
}: GetAiHeadersParams): Record<string, string> | undefined {
  if (builtinProviderId === "anthropic") {
    return {
      "anthropic-beta": "context-1m-2025-08-07",
    };
  }
  return undefined;
}

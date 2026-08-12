import type {
  ModelSelection,
  SmartContextMode,
  UserSettings,
} from "../../lib/schemas";
import type { CodebaseFile } from "../../utils/codebase";
import type { VersionedFiles } from "./versioned_codebase_context";
import { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import {
  getAnthropicProviderOptions,
  getGeminiThinkingBudgetTokens,
  getModelEffort,
} from "./thinking_utils";

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
  reasoningEffortProviderId?: string;
  settings: UserSettings;
  modelSelection: ModelSelection;
}

/**
 * Builds provider options for the AI SDK streamText call.
 * Handles provider-specific configuration including thinking configs for Google/Vertex/Anthropic.
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
  reasoningEffortProviderId,
  settings,
  modelSelection,
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
    openai: {
      reasoningSummary: "auto",
      reasoningEffort: getModelEffort(
        modelSelection,
      ) as OpenAIResponsesProviderOptions["reasoningEffort"],
    } satisfies OpenAIResponsesProviderOptions,
  };
  if (reasoningEffortProviderId) {
    providerOptions[reasoningEffortProviderId] = {
      reasoningEffort: getModelEffort(modelSelection),
    };
  }

  // Conditionally include Google thinking config only for supported models
  const selectedModelName = settings.selectedModel.name || "";
  const providerId = builtinProviderId;
  const isVertex = providerId === "vertex";
  const isGoogle = providerId === "google";
  const isPartnerModel = selectedModelName.includes("/");
  const isGeminiModel = selectedModelName.startsWith("gemini");
  const isFlashLite = selectedModelName.includes("flash-lite");
  const effortLevel = getModelEffort(modelSelection);
  const thinkingConfig = {
    includeThoughts: true,
    ...(selectedModelName.startsWith("gemini-3") &&
    ["minimal", "low", "medium", "high"].includes(effortLevel)
      ? {
          thinkingLevel: effortLevel as "minimal" | "low" | "medium" | "high",
        }
      : { thinkingBudget: getGeminiThinkingBudgetTokens(effortLevel) }),
  } satisfies GoogleGenerativeAIProviderOptions["thinkingConfig"];

  // Keep Google provider behavior unchanged: always include includeThoughts
  if (isGoogle) {
    providerOptions.google = {
      thinkingConfig,
    } satisfies GoogleGenerativeAIProviderOptions;
  }

  // Vertex-specific fix: only enable thinking on supported Gemini models
  if (isVertex && isGeminiModel && !isFlashLite && !isPartnerModel) {
    providerOptions.google = {
      thinkingConfig,
    } satisfies GoogleGenerativeAIProviderOptions;
  }

  if (providerId === "anthropic") {
    providerOptions.anthropic = getAnthropicProviderOptions(modelSelection);
  }

  return providerOptions;
}

// Header used to pass the request ID through AI SDK models that don't forward
// providerOptions into the request body (e.g. OpenAIResponsesLanguageModel).
export const DYAD_INTERNAL_REQUEST_ID_HEADER =
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

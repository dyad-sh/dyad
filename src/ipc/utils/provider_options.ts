import type { ModelSelection, SmartContextMode } from "../../lib/schemas";
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
  modelSelection: ModelSelection;
}

/**
 * The provider-FAMILY slice of {@link getProviderOptions}: the options a model
 * needs because of what it is — thinking/reasoning configuration — independent
 * of the request (dyad ids, files, codebase context).
 *
 * Exists for the auto-mode fallback chain: call options are computed once for
 * the primary selection, so a mid-stream failover to another provider's model
 * previously ran with the PRIMARY's family options — an Anthropic fallback
 * received no `providerOptions.anthropic` at all (no adaptive thinking), and
 * the primary's temperature on top of that is a hard 400. Each chain entry gets
 * the family options it would have received as the primary selection.
 *
 * Kept in lockstep with the family branches of getProviderOptions below —
 * update both when a provider's thinking config changes.
 */
export function getModelScopedProviderOptions({
  providerId,
  modelName,
  modelSelection,
}: {
  providerId: string;
  modelName: string;
  modelSelection: ModelSelection;
}): Record<string, any> {
  if (providerId === "openai") {
    return {
      openai: {
        reasoningSummary: "auto",
        reasoningEffort: getModelEffort(
          modelSelection,
        ) as OpenAIResponsesProviderOptions["reasoningEffort"],
      } satisfies OpenAIResponsesProviderOptions,
    };
  }
  if (providerId === "anthropic") {
    return { anthropic: getAnthropicProviderOptions(modelSelection) };
  }
  if (providerId === "google" || providerId === "vertex") {
    const isGeminiModel = modelName.startsWith("gemini");
    const isFlashLite = modelName.includes("flash-lite");
    const isPartnerModel = modelName.includes("/");
    if (!isGeminiModel || isFlashLite || isPartnerModel) return {};
    const effortLevel = getModelEffort(modelSelection);
    const isKnownGeminiEffort = ["minimal", "low", "medium", "high"].includes(
      effortLevel,
    );
    return {
      google: {
        thinkingConfig: {
          includeThoughts: true,
          ...(modelName.startsWith("gemini-3") && isKnownGeminiEffort
            ? {
                thinkingLevel: effortLevel as
                  | "minimal"
                  | "low"
                  | "medium"
                  | "high",
              }
            : isKnownGeminiEffort
              ? { thinkingBudget: getGeminiThinkingBudgetTokens(effortLevel) }
              : {}),
        },
      } satisfies GoogleGenerativeAIProviderOptions,
    };
  }
  return {};
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
  const selectedModelName = modelSelection.name || "";
  const providerId = builtinProviderId;
  const isVertex = providerId === "vertex";
  const isGoogle = providerId === "google";
  const isPartnerModel = selectedModelName.includes("/");
  const isGeminiModel = selectedModelName.startsWith("gemini");
  const isFlashLite = selectedModelName.includes("flash-lite");
  const effortLevel = getModelEffort(modelSelection);
  const isKnownGeminiEffort = ["minimal", "low", "medium", "high"].includes(
    effortLevel,
  );
  const thinkingConfig = {
    includeThoughts: true,
    ...(selectedModelName.startsWith("gemini-3") && isKnownGeminiEffort
      ? {
          thinkingLevel: effortLevel as "minimal" | "low" | "medium" | "high",
        }
      : isKnownGeminiEffort
        ? { thinkingBudget: getGeminiThinkingBudgetTokens(effortLevel) }
        : {}),
  } satisfies GoogleGenerativeAIProviderOptions["thinkingConfig"];

  // Always request thought summaries; recognized effort levels additionally
  // configure the model-family-specific effort control.
  if (isGoogle && isGeminiModel && !isFlashLite && !isPartnerModel) {
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

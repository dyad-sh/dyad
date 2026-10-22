import { LargeLanguageModel } from "@/lib/schemas";
import { readSettings } from "../../main/settings";
import { Message } from "@/ipc/types";
import { getErrorMessage } from "@ai-sdk/provider";

import { findLanguageModel } from "./findLanguageModel";
import { fetchLMStudioModelContextLength } from "./lm_studio_utils";

// Estimate tokens (4 characters per token)
export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

type ToolResultForTokenEstimate = {
  toolCallId: string;
  toolName: string;
  output: unknown;
};

type ToolErrorForTokenEstimate = {
  toolCallId: string;
  toolName: string;
  error: unknown;
};

/**
 * Estimate the tokens that completed tool results will add to the next model
 * request. Tool inputs are intentionally excluded because the engine's usage
 * for the completed step already counted them.
 */
export const estimateToolResultTokens = (
  toolResults: readonly ToolResultForTokenEstimate[],
  toolErrors: readonly ToolErrorForTokenEstimate[] = [],
): number => {
  if (toolResults.length === 0 && toolErrors.length === 0) {
    return 0;
  }

  const serializedResults = JSON.stringify(
    [
      ...toolResults.map(({ toolCallId, toolName, output }) => ({
        type: "tool-result",
        toolCallId,
        toolName,
        output,
      })),
      ...toolErrors.map(({ toolCallId, toolName, error }) => ({
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "error-text", value: getErrorMessage(error) },
      })),
    ],
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );

  return estimateTokens(serializedResults);
};

export const estimateMessagesTokens = (messages: Message[]): number => {
  return messages.reduce(
    (acc, message) => acc + estimateTokens(message.content),
    0,
  );
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

export async function getContextWindow(model?: LargeLanguageModel) {
  const selectedModel = model ?? readSettings().selectedModel;
  const modelOption = await findLanguageModel(selectedModel);
  if (modelOption?.contextWindow) {
    return modelOption.contextWindow;
  }

  // Local models are not part of the model catalog, so `findLanguageModel`
  // has no context window for them. Ask LM Studio itself before falling back
  // to the generic default, which would otherwise misreport the window for any
  // model loaded with a non-default context length.
  if (selectedModel.provider === "lmstudio") {
    const lmStudioContextWindow = await fetchLMStudioModelContextLength(
      selectedModel.name,
    );
    if (lmStudioContextWindow) {
      return lmStudioContextWindow;
    }
  }

  return DEFAULT_CONTEXT_WINDOW;
}

export async function getMaxTokens(
  model: LargeLanguageModel,
): Promise<number | undefined> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.maxOutputTokens ?? undefined;
}

export async function getTemperature(
  model: LargeLanguageModel,
): Promise<number | undefined> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.temperature ?? undefined;
}

/**
 * Calculate the token threshold for triggering context compaction.
 *
 * Returns the lower of a per-provider cap or `contextWindow - headroom`. The
 * headroom leaves room for the next user message + tool outputs before we hit
 * the hard context limit.
 *
 * The headroom is normally 25k, but shrinks proportionally for windows below
 * 125k. A fixed 25k headroom made `contextWindow - 25_000` clamp to 0 for any
 * window under 25k (a small GPU, or MLX auto-fit), which flagged the chat for
 * compaction after every single message.
 *
 * Per-provider caps differ because of input-token pricing tiers and operational
 * headroom. Google compacts before its 200k pricing boundary, while OpenAI
 * compacts at 220k to leave more room for tool-heavy agent steps. Other
 * providers retain the historical 250k cap.
 */
export function getCompactionThreshold(
  contextWindow: number,
  provider: string,
): number {
  const cap =
    provider === "google" ? 190_000 : provider === "openai" ? 220_000 : 250_000;
  const headroom = Math.min(25_000, Math.floor(contextWindow * 0.2));
  return Math.min(cap, Math.max(0, contextWindow - headroom));
}

/**
 * Check if compaction should be triggered based on total tokens used.
 */
export function shouldTriggerCompaction(
  totalTokens: number,
  contextWindow: number,
  provider: string,
): boolean {
  return totalTokens >= getCompactionThreshold(contextWindow, provider);
}

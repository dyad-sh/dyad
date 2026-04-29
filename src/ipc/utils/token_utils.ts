import { LargeLanguageModel } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import { Message } from "@/ipc/types";

import { findLanguageModel } from "./findLanguageModel";
import { resolveAutoModelForSettings } from "./auto_model_utils";

// Estimate tokens (4 characters per token)
export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

export const estimateMessagesTokens = (messages: Message[]): number => {
  return messages.reduce(
    (acc, message) => acc + estimateTokens(message.content),
    0,
  );
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

export async function getContextWindow() {
  const settings = readSettings();
  const modelOption = await findLanguageModel(settings.selectedModel);
  return modelOption?.contextWindow || DEFAULT_CONTEXT_WINDOW;
}

export async function getCompactionThresholdForSelectedModel() {
  const settings = readSettings();

  if (
    settings.selectedModel.provider === "auto" &&
    settings.selectedModel.name === "auto"
  ) {
    const resolvedAutoModel = await resolveAutoModelForSettings(settings);
    if (resolvedAutoModel) {
      const modelOption = await findLanguageModel(resolvedAutoModel);
      const contextWindow =
        modelOption?.contextWindow || DEFAULT_CONTEXT_WINDOW;
      return getCompactionThreshold({
        contextWindow,
        compactionWindow: modelOption?.compactionWindow,
      });
    }
  }

  const modelOption = await findLanguageModel(settings.selectedModel);
  const contextWindow = modelOption?.contextWindow || DEFAULT_CONTEXT_WINDOW;
  return getCompactionThreshold({
    contextWindow,
    compactionWindow: modelOption?.compactionWindow,
  });
}

export async function getMaxTokens(
  model: LargeLanguageModel,
): Promise<number | undefined> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.maxOutputTokens ?? undefined;
}

export async function getTemperature(
  model: LargeLanguageModel,
): Promise<number> {
  const modelOption = await findLanguageModel(model);
  return modelOption?.temperature ?? 0;
}

/**
 * Calculate the token threshold for triggering context compaction.
 * Uses the model's explicit compaction window when present. Otherwise returns
 * the minimum of 80% of context window or 180k tokens.
 */
export function getCompactionThreshold({
  contextWindow,
  compactionWindow,
}: {
  contextWindow: number;
  compactionWindow?: number;
}): number {
  if (compactionWindow !== undefined) {
    return compactionWindow;
  }
  return Math.min(Math.floor(contextWindow * 0.8), 180_000);
}

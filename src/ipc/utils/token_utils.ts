import { LargeLanguageModel } from "@/lib/schemas";
import { readSettings } from "../../main/settings";
import { Message } from "@/ipc/types";

import { findLanguageModel } from "./findLanguageModel";

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
  if (modelOption?.type === "custom") {
    return modelOption.temperature;
  }
  return modelOption?.temperature ?? 0;
}

/**
 * Calculate the token threshold for triggering context compaction.
 *
 * Returns the lower of a per-provider cap or `contextWindow - 25k`. The 25k
 * headroom leaves room for the next user message + tool outputs before we hit
 * the hard context limit.
 *
 * Per-provider caps differ because of input-token pricing tiers: Google bumps
 * input price 2x once a request crosses 200k tokens, while other providers
 * (e.g. OpenAI) only apply a 2x tier above ~272k tokens. We compact earlier
 * for Google so requests stay in the cheaper input tier.
 */
export function getCompactionThreshold(
  contextWindow: number,
  provider: string,
): number {
  const cap = provider === "google" ? 190_000 : 250_000;
  return Math.min(cap, Math.max(0, contextWindow - 25_000));
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

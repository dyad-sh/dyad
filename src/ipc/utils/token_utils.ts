import { readSettings } from "../../main/settings";
import { Message } from "../ipc_types";
import { MODEL_OPTIONS } from "../../constants/models";
import log from "electron-log";

const logger = log.scope("token_utils");

// Estimate tokens (4 characters per token)
export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

export const estimateMessagesTokens = (messages: Message[]): number => {
  return messages.reduce(
    (acc, message) => acc + estimateTokens(message.content),
    0
  );
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

export function getContextWindow() {
  const settings = readSettings();
  const model = settings.selectedModel;
  if (!MODEL_OPTIONS[model.provider as keyof typeof MODEL_OPTIONS]) {
    logger.warn(
      `Model provider ${model.provider} not found in MODEL_OPTIONS. Using default max tokens.`
    );
    return DEFAULT_CONTEXT_WINDOW;
  }
  const modelOption = MODEL_OPTIONS[
    model.provider as keyof typeof MODEL_OPTIONS
  ].find((m) => m.name === model.name);
  return modelOption?.contextWindow || DEFAULT_CONTEXT_WINDOW;
}

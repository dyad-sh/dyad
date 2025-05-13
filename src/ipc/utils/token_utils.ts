import { LargeLanguageModel } from "@/lib/schemas";
import { readSettings } from "../../main/settings";
import { Message } from "../ipc_types";

import { getLanguageModels } from "../shared/language_model_helpers";

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

// Most models support at least 8000 output tokens so we use it as a default value.
const DEFAULT_MAX_TOKENS = 8_000;

export async function getMaxTokens(model: LargeLanguageModel) {
  const modelOption = await findLanguageModel(model);
  return modelOption?.maxOutputTokens || DEFAULT_MAX_TOKENS;
}

async function findLanguageModel(model: LargeLanguageModel) {
  const models = await getLanguageModels({
    providerId: model.provider,
  });

  if (model.customModelId) {
    const customModel = models.find(
      (m) => m.type === "custom" && m.id === model.customModelId,
    );
    if (customModel) {
      return customModel;
    }
  }

  return models.find((m) => m.apiName === model.name);
}

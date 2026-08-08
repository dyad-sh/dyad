import { getAiCoderChatAgentModel } from "./ai_coder";
import { getAssignedModelForRole } from "./model_roles";
import type { LargeLanguageModel, UserSettings } from "./schemas";

/** Providers allowed for the Chat Agent inference model. */
export const CHAT_AGENT_MODEL_PROVIDERS = [
  "openrouter",
  "openai",
  "lmstudio",
  "phantom",
  // Vercel AI Gateway. Without it a gateway model chosen in Settings was
  // rejected here and the chat bar silently fell back to `selectedModel`,
  // showing a different model than Settings did.
  "vercel",
] as const;

export type ChatAgentModelProvider =
  (typeof CHAT_AGENT_MODEL_PROVIDERS)[number];

/** Providers shown as horizontal tabs in the clean model picker. */
export const MODEL_PICKER_PROVIDERS = [
  "lmstudio",
  "openrouter",
  "phantom",
] as const;
export type ModelPickerProvider = (typeof MODEL_PICKER_PROVIDERS)[number];

export function isChatAgentModelProvider(
  provider: string,
): provider is ChatAgentModelProvider {
  return (CHAT_AGENT_MODEL_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Resolves the model used by the Chat Agent.
 * Uses `chatAgentModel` when set; otherwise falls back to the Coding Agent model.
 */
export function getChatAgentModel(settings: UserSettings): LargeLanguageModel {
  const roleModel = getAssignedModelForRole(settings, "chat");
  if (roleModel) {
    return roleModel;
  }

  const aiCoderModel = getAiCoderChatAgentModel(settings);
  if (aiCoderModel) {
    return aiCoderModel;
  }

  const configured = settings.chatAgentModel;
  if (configured && isChatAgentModelProvider(configured.provider)) {
    return configured;
  }
  return settings.selectedModel;
}

export function getConfiguredChatAgentModel(
  settings: UserSettings,
): LargeLanguageModel | undefined {
  const configured = settings.chatAgentModel;
  if (configured && isChatAgentModelProvider(configured.provider)) {
    return configured;
  }
  return undefined;
}

/**
 * Returns an OpenRouter fallback when an automatically managed chat role points
 * at an unavailable local model. Manual role assignments never fall back to a
 * cloud provider without the user's explicit choice.
 */
export function getOpenRouterFallbackForLocalChatModel(
  settings: UserSettings,
  selectedModel: LargeLanguageModel,
): LargeLanguageModel | undefined {
  if (
    selectedModel.provider !== "lmstudio" &&
    selectedModel.provider !== "ollama"
  ) {
    return undefined;
  }
  if (settings.modelRoles?.chat?.auto === false) {
    return undefined;
  }

  const openRouterKey =
    settings.providerSettings?.openrouter?.apiKey?.value?.trim();
  if (!openRouterKey) {
    return undefined;
  }

  const configuredOpenRouterModel =
    settings.aiCoder?.provider === "openrouter"
      ? settings.aiCoder.model?.trim()
      : undefined;
  return {
    provider: "openrouter",
    name: configuredOpenRouterModel || selectedModel.name,
  };
}

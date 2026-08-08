import type { LargeLanguageModel, UserSettings } from "./schemas";

export const PHANTOM_PROVIDER_ID = "phantom" as const;

/** OpenAI-compatible base URL (path `/chat/completions` is appended by the SDK). */
export const PHANTOM_HERMES_API_BASE = "http://192.168.68.111:8642/v1";

/** Display-only full completions URL shown in settings. */
export const PHANTOM_HERMES_COMPLETIONS_URL = `${PHANTOM_HERMES_API_BASE}/chat/completions`;

/** Hardcoded Hermes Phantom API key, used as a fallback when no key is saved. */
export const PHANTOM_HERMES_DEFAULT_API_KEY =
  "phantom-elevenlabs-14a7b4d705211fb411a62455acea7aef";

export const DEFAULT_PHANTOM_MODEL = "hermes";

export const AI_SETTINGS_CHANGED_EVENT = "ai-settings-changed";

export type AiCoderProvider = "phantom" | "openai" | "lmstudio" | "openrouter";

export function dispatchAiSettingsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_SETTINGS_CHANGED_EVENT));
}

export function getAiCoderProvider(settings: UserSettings): AiCoderProvider {
  const p = settings.aiCoder?.provider;
  if (p === "openai" || p === "lmstudio" || p === "openrouter") return p;
  return "phantom";
}

export function isAiCoderEnabledForChatAgent(settings: UserSettings): boolean {
  return settings.aiCoder?.enableForChatAgent === true;
}

export function isAiCoderEnabledForCodeCompletion(
  settings: UserSettings,
): boolean {
  return settings.aiCoder?.enableForCodeCompletion === true;
}

export function shouldStreamAiCoderResponses(settings: UserSettings): boolean {
  return settings.aiCoder?.streamResponses !== false;
}

export function normalizePhantomHermesApiBase(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return PHANTOM_HERMES_API_BASE;
  }
  return trimmed.replace(/\/chat\/completions$/i, "");
}

export function getPhantomHermesApiBase(settings: UserSettings): string {
  return normalizePhantomHermesApiBase(
    settings.aiCoder?.endpoint || PHANTOM_HERMES_API_BASE,
  );
}

export function getPhantomHermesCompletionsUrl(settings: UserSettings): string {
  return `${getPhantomHermesApiBase(settings)}/chat/completions`;
}

/**
 * When AI Coder is enabled for Chat Agent, route inference through Phantom or OpenAI.
 */
export function getAiCoderChatAgentModel(
  settings: UserSettings,
): LargeLanguageModel | undefined {
  if (!isAiCoderEnabledForChatAgent(settings)) {
    return undefined;
  }

  const provider = getAiCoderProvider(settings);
  if (provider === "phantom") {
    return {
      provider: PHANTOM_PROVIDER_ID,
      name: settings.aiCoder?.model?.trim() || DEFAULT_PHANTOM_MODEL,
    };
  }

  if (provider === "lmstudio" || provider === "openrouter") {
    const name = settings.aiCoder?.model?.trim();
    return name ? { provider, name } : undefined;
  }

  const openaiModel = settings.aiCoder?.openaiModel?.trim();
  if (openaiModel) {
    return { provider: "openai", name: openaiModel };
  }

  const fromChatAgent = settings.chatAgentModel;
  if (fromChatAgent?.provider === "openai") {
    return fromChatAgent;
  }

  if (settings.selectedModel?.provider === "openai") {
    return settings.selectedModel;
  }

  return { provider: "openai", name: "gpt-4o-mini" };
}

export function getPhantomApiKey(settings: UserSettings): string {
  // Saved key wins; otherwise fall back to the hardcoded Hermes Phantom key so
  // the chat agent works even when the settings haven't persisted a key.
  return (
    settings.providerSettings?.[PHANTOM_PROVIDER_ID]?.apiKey?.value?.trim() ||
    PHANTOM_HERMES_DEFAULT_API_KEY
  );
}

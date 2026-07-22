import {
  getEffectiveDefaultChatMode,
  type ChatMode,
  type UserSettings,
} from "./schemas";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  isFreeProBuildModeCombination,
} from "./freeProModel";

export function getHomeDefaultChatMode(
  settings: UserSettings,
  envVars: Record<string, string | undefined>,
  freeAgentQuotaAvailable?: boolean,
): ChatMode {
  const effectiveDefault = getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );
  return isFreeProBuildModeCombination(settings.selectedModel, effectiveDefault)
    ? FREE_PRO_MODEL_FALLBACK_CHAT_MODE
    : effectiveDefault;
}

import {
  getEffectiveDefaultChatMode,
  type ChatMode,
  type UserSettings,
} from "./schemas";
import { getFreeProCompatibleChatMode } from "./freeProModel";

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
  return getFreeProCompatibleChatMode(settings.selectedModel, effectiveDefault);
}

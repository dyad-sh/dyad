import {
  getEffectiveDefaultChatMode,
  type ChatMode,
  type UserSettings,
} from "./schemas";
import { getFreeProCompatibleChatMode } from "./freeProModel";

export function getHomeDefaultChatMode(
  settings: UserSettings,
  envVars: Record<string, string | undefined>,
): ChatMode {
  const effectiveDefault = getEffectiveDefaultChatMode(settings, envVars);
  return getFreeProCompatibleChatMode(settings.selectedModel, effectiveDefault);
}

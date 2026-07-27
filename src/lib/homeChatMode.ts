import {
  getEffectiveDefaultChatMode,
  type ChatMode,
  type UserSettings,
} from "./schemas";

export function getHomeDefaultChatMode(settings: UserSettings): ChatMode {
  return getEffectiveDefaultChatMode(settings);
}

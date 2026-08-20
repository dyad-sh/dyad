import type { ChatMode, UserSettings } from "@/lib/schemas";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";

export function resolveFirstPromptDefaultChatMode({
  settings,
  envVars,
}: {
  settings: UserSettings;
  envVars: Record<string, string | undefined>;
}): ChatMode {
  return getHomeDefaultChatMode(settings, envVars);
}

import { type ChatMode, type UserSettings } from "@/lib/schemas";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";

export async function resolveFirstPromptDefaultChatMode({
  settings,
}: {
  settings: UserSettings;
}): Promise<ChatMode> {
  return getHomeDefaultChatMode(settings);
}

import { type ChatMode, type UserSettings } from "@/lib/schemas";
import {
  normalizeStoredChatMode,
  resolveChatMode,
  type ChatModeResolution,
} from "@/lib/chatMode";
import { readSettings } from "@/main/settings";

export { normalizeStoredChatMode };

export async function resolveChatModeForTurn({
  storedChatMode,
  requestedChatMode,
  settings = readSettings(),
}: {
  storedChatMode: string | null | undefined;
  requestedChatMode?: ChatMode | null;
  settings?: UserSettings;
}): Promise<ChatModeResolution & { settings: UserSettings }> {
  const modeForTurn =
    requestedChatMode === undefined ? storedChatMode : requestedChatMode;
  const resolution = resolveChatMode({
    storedChatMode: modeForTurn,
    settings,
  });

  return {
    ...resolution,
    settings,
  };
}

export async function getInitialChatModeForNewChat(
  initialChatMode?: ChatMode,
): Promise<ChatMode | null> {
  return initialChatMode ?? null;
}

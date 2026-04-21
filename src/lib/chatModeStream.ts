import type { ChatMode, UserSettings } from "./schemas";
import { isDyadProEnabled } from "./schemas";
import type { ChatModeFallbackReason } from "./chatMode";
import { showChatModeFallbackToast } from "./chatModeToast";

export function handleEffectiveChatModeChunk(
  chunk: {
    effectiveChatMode?: ChatMode;
    chatModeFallbackReason?: ChatModeFallbackReason;
  },
  settings: UserSettings | null | undefined,
): boolean {
  if (!chunk.effectiveChatMode) {
    return false;
  }

  if (chunk.chatModeFallbackReason) {
    showChatModeFallbackToast({
      reason: chunk.chatModeFallbackReason,
      effectiveMode: chunk.effectiveChatMode,
      isPro: settings ? isDyadProEnabled(settings) : false,
    });
  }

  return true;
}

import {
  getEffectiveDefaultChatMode,
  migrateStoredChatMode,
  StoredChatModeSchema,
  type ChatMode,
  type UserSettings,
} from "./schemas";

export interface ChatModeResolution {
  mode: ChatMode;
}

export function normalizeStoredChatMode(
  mode: string | null | undefined,
): ChatMode | null {
  if (!mode) {
    return null;
  }

  const parsed = StoredChatModeSchema.safeParse(mode);
  if (!parsed.success) {
    return null;
  }

  return migrateStoredChatMode(parsed.data) ?? null;
}

export function resolveChatMode({
  storedChatMode,
  settings,
}: {
  storedChatMode: string | null | undefined;
  settings: UserSettings;
}): ChatModeResolution {
  const chatMode = normalizeStoredChatMode(storedChatMode);
  const effectiveDefault = getEffectiveDefaultChatMode(settings);

  if (!chatMode) {
    return { mode: effectiveDefault };
  }

  return { mode: chatMode };
}

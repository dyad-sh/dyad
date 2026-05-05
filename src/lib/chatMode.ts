import {
  getEffectiveDefaultChatMode,
  isDyadProEnabled,
  migrateStoredChatMode,
  StoredChatModeSchema,
  type ChatMode,
  type UserSettings,
} from "./schemas";

export type ChatModeFallbackReason = "quota-exhausted";

export interface ChatModeResolution {
  mode: ChatMode;
  fallbackReason?: ChatModeFallbackReason;
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

export function getUnavailableChatModeReason({
  mode,
  settings,
  freeAgentQuotaAvailable,
}: {
  mode: ChatMode | null | undefined;
  settings: UserSettings;
  freeAgentQuotaAvailable?: boolean;
}): ChatModeFallbackReason | undefined {
  if (mode !== "local-agent") {
    return undefined;
  }

  if (isDyadProEnabled(settings)) {
    return undefined;
  }

  if (freeAgentQuotaAvailable === false) {
    return "quota-exhausted";
  }

  return undefined;
}

export function resolveChatMode({
  storedChatMode,
  settings,
  envVars,
  freeAgentQuotaAvailable,
}: {
  storedChatMode: string | null | undefined;
  settings: UserSettings;
  envVars: Record<string, string | undefined>;
  freeAgentQuotaAvailable?: boolean;
}): ChatModeResolution {
  const chatMode = normalizeStoredChatMode(storedChatMode);
  const effectiveDefault = getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );

  if (!chatMode) {
    return { mode: effectiveDefault };
  }

  const fallbackReason = getUnavailableChatModeReason({
    mode: chatMode,
    settings,
    freeAgentQuotaAvailable,
  });

  if (fallbackReason && effectiveDefault !== chatMode) {
    return { mode: effectiveDefault, fallbackReason };
  }

  return { mode: chatMode };
}

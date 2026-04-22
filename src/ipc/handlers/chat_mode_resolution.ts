import {
  getEffectiveDefaultChatMode,
  isDyadProEnabled,
  type ChatMode,
  type UserSettings,
} from "@/lib/schemas";
import {
  normalizeStoredChatMode,
  resolveChatMode,
  type ChatModeResolution,
} from "@/lib/chatMode";
import { readSettings } from "@/main/settings";
import { PROVIDER_TO_ENV_VAR } from "@/ipc/shared/language_model_constants";
import { getEnvVar } from "@/ipc/utils/read_env";
import { getFreeAgentQuotaStatus } from "./free_agent_quota_handlers";

export { normalizeStoredChatMode };

export async function resolveChatModeForTurn({
  storedChatMode,
  requestedChatMode,
  settings = readSettings(),
}: {
  storedChatMode: string | null | undefined;
  requestedChatMode?: ChatMode;
  settings?: UserSettings;
}): Promise<ChatModeResolution & { settings: UserSettings }> {
  const modeForTurn = requestedChatMode ?? storedChatMode;
  const normalizedChatMode = normalizeStoredChatMode(modeForTurn);
  const envVars = getChatModeEnvVars();
  const freeAgentQuotaAvailable = await getFreeAgentQuotaAvailableIfNeeded(
    settings,
    normalizedChatMode,
  );

  return {
    ...resolveChatMode({
      storedChatMode: modeForTurn,
      settings,
      envVars,
      freeAgentQuotaAvailable,
    }),
    settings,
  };
}

export async function getInitialChatModeForNewChat(
  initialChatMode?: ChatMode,
): Promise<ChatMode> {
  if (initialChatMode) {
    return initialChatMode;
  }

  const settings = readSettings();
  if (settings.selectedChatMode) {
    return settings.selectedChatMode;
  }

  const envVars = getChatModeEnvVars();
  const freeAgentQuotaAvailable = await getFreeAgentQuotaAvailableIfNeeded(
    settings,
    null,
  );

  return getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );
}

function getChatModeEnvVars(): Record<string, string | undefined> {
  const openAiEnvVar = PROVIDER_TO_ENV_VAR.openai;
  const anthropicEnvVar = PROVIDER_TO_ENV_VAR.anthropic;

  return {
    [openAiEnvVar]: getEnvVar(openAiEnvVar),
    [anthropicEnvVar]: getEnvVar(anthropicEnvVar),
  };
}

async function getFreeAgentQuotaAvailableIfNeeded(
  settings: UserSettings,
  chatMode: ChatMode | null,
): Promise<boolean | undefined> {
  if (isDyadProEnabled(settings)) {
    return undefined;
  }

  const defaultMayUseLocalAgent =
    !settings.defaultChatMode || settings.defaultChatMode === "local-agent";
  const needsQuota =
    chatMode === "local-agent" ||
    (chatMode === null && defaultMayUseLocalAgent);

  if (!needsQuota) {
    return undefined;
  }

  const quotaStatus = await getFreeAgentQuotaStatus();
  return !quotaStatus.isQuotaExceeded;
}

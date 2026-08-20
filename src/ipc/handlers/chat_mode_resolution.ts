import { type ChatMode, type UserSettings } from "@/lib/schemas";
import {
  normalizeStoredChatMode,
  resolveChatMode,
  type ChatModeResolution,
} from "@/lib/chatMode";
import {
  FREE_PRO_BUILD_MODE_ERROR,
  getFreeProCompatibleChatMode,
  isFreeProBuildModeCombination,
} from "@/lib/freeProModel";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { PROVIDER_TO_ENV_VAR } from "@/ipc/shared/language_model_constants";
import { getEnvVar } from "@/ipc/utils/read_env";

export { normalizeStoredChatMode };

export function assertChatModeCompatibleWithModel(
  settings: UserSettings,
  chatMode: ChatMode,
): void {
  if (isFreeProBuildModeCombination(settings.selectedModel, chatMode)) {
    throw new DyadError(FREE_PRO_BUILD_MODE_ERROR, DyadErrorKind.Precondition);
  }
}

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
  const normalizedChatMode = normalizeStoredChatMode(modeForTurn);
  const envVars = getChatModeEnvVars();

  const resolution = resolveChatMode({
    storedChatMode: modeForTurn,
    settings,
    envVars,
  });

  return {
    ...resolution,
    mode:
      normalizedChatMode === null
        ? getFreeProCompatibleChatMode(settings.selectedModel, resolution.mode)
        : resolution.mode,
    settings,
  };
}

export async function getInitialChatModeForNewChat(
  initialChatMode?: ChatMode,
): Promise<ChatMode | null> {
  return initialChatMode ?? null;
}

function getChatModeEnvVars(): Record<string, string | undefined> {
  const envVarNames = new Set([
    ...Object.values(PROVIDER_TO_ENV_VAR),
    "AZURE_RESOURCE_NAME",
  ]);

  return Object.fromEntries(
    [...envVarNames].map((envVarName) => [envVarName, getEnvVar(envVarName)]),
  );
}

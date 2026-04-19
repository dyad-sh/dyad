import { ipc } from "@/ipc/types";
import { ChatMode, isChatModeAllowed, type UserSettings } from "@/lib/schemas";

export function getChatModeLabelKey(
  mode: ChatMode,
  { isProEnabled = true }: { isProEnabled?: boolean } = {},
):
  | "chatMode.build"
  | "chatMode.ask"
  | "chatMode.agent"
  | "chatMode.basicAgent"
  | "chatMode.plan" {
  switch (mode) {
    case "build":
      return "chatMode.build";
    case "ask":
      return "chatMode.ask";
    case "local-agent":
      return isProEnabled ? "chatMode.agent" : "chatMode.basicAgent";
    case "plan":
      return "chatMode.plan";
  }
}

export function getLocalAgentUnavailableReasonKey(
  freeAgentQuotaExceeded: boolean,
): "chatMode.agentUnavailableQuota" | "chatMode.agentUnavailableProvider" {
  return freeAgentQuotaExceeded
    ? "chatMode.agentUnavailableQuota"
    : "chatMode.agentUnavailableProvider";
}

export function resolveAllowedChatMode({
  desiredMode,
  fallbackMode,
  settings,
  envVars,
  freeAgentQuotaAvailable,
}: {
  desiredMode: ChatMode;
  fallbackMode: ChatMode;
  settings: UserSettings;
  envVars: Record<string, string | undefined>;
  freeAgentQuotaAvailable: boolean;
}): { mode: ChatMode; usedFallback: boolean } {
  if (
    isChatModeAllowed(desiredMode, settings, envVars, freeAgentQuotaAvailable)
  ) {
    return { mode: desiredMode, usedFallback: false };
  }

  if (
    isChatModeAllowed(fallbackMode, settings, envVars, freeAgentQuotaAvailable)
  ) {
    return { mode: fallbackMode, usedFallback: true };
  }

  return { mode: "build", usedFallback: true };
}

//This  prevents duplication of the fire-and-forget pattern used in other components
export async function persistChatModeToDb(
  chatId: number,
  appId: number,
  chatMode: ChatMode,
): Promise<void> {
  await ipc.chat.updateChatMode({ chatId, appId, chatMode });
}

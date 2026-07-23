import type { QueryClient } from "@tanstack/react-query";
import { ipc, type FreeAgentQuotaStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { hasDyadProKey, type ChatMode, type UserSettings } from "@/lib/schemas";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";

export async function resolveFirstPromptDefaultChatMode({
  settings,
  envVars,
  quotaStatus,
  queryClient,
}: {
  settings: UserSettings;
  envVars: Record<string, string | undefined>;
  quotaStatus?: FreeAgentQuotaStatus;
  queryClient: QueryClient;
}): Promise<ChatMode> {
  let resolvedQuotaStatus = quotaStatus;
  if (!hasDyadProKey(settings) && !resolvedQuotaStatus) {
    try {
      resolvedQuotaStatus = await queryClient.fetchQuery({
        queryKey: queryKeys.freeAgentQuota.status,
        queryFn: () => ipc.freeAgentQuota.getFreeAgentQuotaStatus(),
      });
    } catch {
      // Preserve the safe Build-mode fallback when quota cannot be resolved.
    }
  }

  return getHomeDefaultChatMode(
    settings,
    envVars,
    resolvedQuotaStatus ? !resolvedQuotaStatus.isQuotaExceeded : undefined,
  );
}

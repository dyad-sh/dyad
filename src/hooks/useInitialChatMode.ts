import { useSettings } from "./useSettings";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { getEffectiveDefaultChatMode } from "@/lib/schemas";
import type { ChatMode } from "@/lib/schemas";

/**
 * Hook to compute the initial/default chat mode.
 *
 * Combines:
 * - User's selectedChatMode setting (global default)
 * - Environment variables (DYAD_MODE override)
 * - Free agent quota availability (disables "local-agent" if quota exceeded)
 *
 * Returns the effective mode to use when creating new chats or when none is specified.
 *
 * REPLACES duplicated pattern in: ChatList, ChatHeader, DyadAppMediaFolder, app-details
 */
export function useInitialChatMode(): ChatMode | undefined {
  const { settings, envVars } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();

  if (!settings) {
    return undefined; // Settings not loaded yet
  }

  const freeAgentQuotaAvailable = !isQuotaLoading && !isQuotaExceeded;

  return getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );
}

import { useSettings } from "./useSettings";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { getEffectiveDefaultChatMode, isDyadProEnabled } from "@/lib/schemas";
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
 * Returns undefined while loading initial settings or quota status (to prevent premature persistence during startup).
 *
 * REPLACES duplicated pattern in: ChatList, ChatHeader, DyadAppMediaFolder, app-details
 */
export function useInitialChatMode(): ChatMode | undefined {
  const { settings, envVars } = useSettings();
  const { isQuotaExceeded, isLoading: isQuotaLoading } = useFreeAgentQuota();

  if (!settings) {
    return undefined; // Settings not loaded yet
  }

  // For non-Pro users, wait until quota status is known before calculating mode.
  // This prevents chat creation during startup from persisting an incorrect mode
  // (e.g., "build" when quota is still loading, leading to wrong mode being stored).
  const isPro = isDyadProEnabled(settings);
  if (!isPro && isQuotaLoading) {
    return undefined; // Quota status still loading, need to wait
  }

  const freeAgentQuotaAvailable = !isQuotaExceeded;

  return getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );
}

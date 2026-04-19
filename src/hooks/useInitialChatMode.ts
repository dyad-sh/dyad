import { useSettings } from "./useSettings";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import { getEffectiveDefaultChatMode, isDyadProEnabled } from "@/lib/schemas";
import type { ChatMode } from "@/lib/schemas";

//Hook to compute the initial/default chat mode.
export function useInitialChatMode(): ChatMode | undefined {
  const { settings, envVars, loading: settingsLoading } = useSettings();
  const {
    isQuotaExceeded,
    isLoading: isQuotaLoading,
    quotaStatus,
  } = useFreeAgentQuota();
  if (!settings || settingsLoading) {
    return undefined;
  }

  // For non-Pro users wait until quota status is known before calculating mode.
  const isPro = isDyadProEnabled(settings);
  if (!isPro && isQuotaLoading) {
    return undefined;
  }
  const freeAgentQuotaAvailable = quotaStatus !== null && !isQuotaExceeded;
  return getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type FreeAgentQuotaStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "./useSettings";
import { isDyadProEnabled } from "@/lib/schemas";

const THIRTY_MINUTES_IN_MS = 30 * 60 * 1000;
// In test mode, use very short staleTime for faster E2E tests
const STALE_TIME_MS = 30_000;
const TEST_STALE_TIME_MS = 500;

/**
 * Hook to get the free agent quota status for non-Pro users.
 *
 * - Only fetches for non-Pro users (Pro users have unlimited access)
 * - Refetches every 30 minutes to update the UI when quota resets
 * - Returns quota status including messages used, limit, and time until reset
 */
export function useFreeAgentQuota() {
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const isPro = settings ? isDyadProEnabled(settings) : false;
  const isTestMode = settings?.isTestMode ?? false;

  const {
    data: quotaStatus,
    isLoading,
    error,
  } = useQuery<FreeAgentQuotaStatus, Error, FreeAgentQuotaStatus>({
    queryKey: queryKeys.freeAgentQuota.status,
    queryFn: () => ipc.freeAgentQuota.getFreeAgentQuotaStatus(),
    // Only fetch for non-Pro users
    enabled: !isPro && !!settings,
    // Refetch periodically to check for quota reset
    refetchInterval: THIRTY_MINUTES_IN_MS,
    // Consider stale after 30 seconds (500ms in test mode for faster E2E tests)
    staleTime: isTestMode ? TEST_STALE_TIME_MS : STALE_TIME_MS,
    // Don't retry on error (e.g., if there's an issue with the DB)
    retry: false,
  });

  const invalidateQuota = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.freeAgentQuota.status,
    });
  };

  return {
    quotaStatus,
    isLoading,
    error,
    invalidateQuota,
    // Convenience properties for easier consumption
    isQuotaExceeded: quotaStatus?.isQuotaExceeded ?? false,
    messagesUsed: quotaStatus?.messagesUsed ?? 0,
    messagesLimit: quotaStatus?.messagesLimit ?? 5,
    messagesRemaining: quotaStatus
      ? Math.max(0, quotaStatus.messagesLimit - quotaStatus.messagesUsed)
      : 5,
    hoursUntilReset: quotaStatus?.hoursUntilReset ?? null,
    resetTime: quotaStatus?.resetTime ?? null,
  };
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type FreeModelQuotaStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "./useSettings";
import { isDyadProEnabled } from "@/lib/schemas";
import { useUserBudgetInfo } from "./useUserBudgetInfo";

const THIRTY_MINUTES_IN_MS = 30 * 60 * 1000;
const STALE_TIME_MS = 30_000;
const TEST_STALE_TIME_MS = 500;
const FREE_MODEL_QUOTA_LIMIT = 10;

export function useFreeModelQuota() {
  const { settings } = useSettings();
  const queryClient = useQueryClient();
  const { userBudget, isLoadingUserBudget } = useUserBudgetInfo();
  const isPro = settings ? isDyadProEnabled(settings) : false;
  const isTrial = userBudget?.isTrial === true;
  const isTestMode = settings?.isTestMode ?? false;

  const {
    data: quotaStatus,
    isLoading,
    error,
  } = useQuery<FreeModelQuotaStatus, Error, FreeModelQuotaStatus>({
    queryKey: queryKeys.freeModelQuota.status,
    queryFn: () => ipc.freeModelQuota.getFreeModelQuotaStatus(),
    enabled: !!settings && isPro && !isTrial && !isLoadingUserBudget,
    refetchInterval: THIRTY_MINUTES_IN_MS,
    staleTime: isTestMode ? TEST_STALE_TIME_MS : STALE_TIME_MS,
    retry: false,
  });

  const invalidateQuota = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.freeModelQuota.status,
    });
  };

  return {
    quotaStatus,
    isLoading,
    error,
    invalidateQuota,
    isQuotaExceeded: quotaStatus?.isQuotaExceeded ?? false,
    messagesUsed: quotaStatus?.messagesUsed ?? 0,
    messagesLimit: quotaStatus?.messagesLimit ?? FREE_MODEL_QUOTA_LIMIT,
    messagesRemaining: quotaStatus?.messagesRemaining ?? FREE_MODEL_QUOTA_LIMIT,
    resetTime: quotaStatus?.resetTime ?? null,
  };
}

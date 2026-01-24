import { useQuery } from "@tanstack/react-query";
import { ipc, type UserBudgetInfo } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;

export function useUserBudgetInfo() {
  const { data, isLoading, error, isFetching, refetch } = useQuery<
    UserBudgetInfo | null,
    Error,
    UserBudgetInfo | null
  >({
    queryKey: queryKeys.userBudget.info,
    queryFn: async () => {
      return ipc.system.getUserBudget();
    },
    // This data is not critical and can be stale for a bit
    staleTime: FIVE_MINUTES_IN_MS,
    // If an error occurs (e.g. API key not set), it returns null.
    // We don't want react-query to retry automatically in such cases as it's not a transient network error.
    retry: false,
  });

  return {
    userBudget: data,
    isLoadingUserBudget: isLoading,
    userBudgetError: error,
    isFetchingUserBudget: isFetching,
    refetchUserBudget: refetch,
  };
}

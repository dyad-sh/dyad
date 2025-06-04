import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { UserBudgetInfo } from "@/ipc/ipc_types";

const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;

export function useUserBudgetInfo() {
  const queryKey = ["userBudgetInfo"];

  const { data, isLoading, error, isFetching, refetch } = useQuery<
    UserBudgetInfo | null,
    Error,
    UserBudgetInfo | null
  >({
    queryKey: queryKey,
    queryFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.getUserBudget();
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type ClaudeCodeStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const STATUS_STALE_TIME_MS = 30_000;

/**
 * Claude Code (Subscription backend) setup state: CLI installed/supported,
 * signed in, Dyad charge acknowledged, billing ready.
 */
export function useClaudeCodeStatus({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery<ClaudeCodeStatus, Error>({
    queryKey: queryKeys.claudeCode.status,
    queryFn: () => ipc.claudeCode.getStatus({ refresh: false }),
    enabled,
    staleTime: STATUS_STALE_TIME_MS,
    retry: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => ipc.claudeCode.getStatus({ refresh: true }),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.claudeCode.status, status);
    },
  });

  const acknowledgeChargeMutation = useMutation({
    mutationFn: () => ipc.claudeCode.acknowledgeCharge(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.claudeCode.status,
      });
    },
  });

  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refresh: refreshMutation.mutateAsync,
    isRefreshing: refreshMutation.isPending,
    acknowledgeCharge: acknowledgeChargeMutation.mutateAsync,
  };
}

export function useClaudeCodeUsageSummary({
  enabled = true,
  limit,
}: { enabled?: boolean; limit?: number } = {}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.claudeCode.usage({ limit: limit ?? null }),
    queryFn: () =>
      ipc.claudeCode.getUsageSummary(limit ? { limit } : undefined),
    enabled,
    staleTime: 10_000,
    retry: false,
  });
  const retryMutation = useMutation({
    mutationFn: () => ipc.claudeCode.retryUsageReports(),
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.claudeCode.all,
      });
    },
  });
  return {
    summary: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    retryReports: retryMutation.mutateAsync,
    isRetrying: retryMutation.isPending,
    refetch: query.refetch,
  };
}

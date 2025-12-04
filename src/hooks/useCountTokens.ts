import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { TokenCountResult } from "@/ipc/ipc_types";
import { useCallback } from "react";

export const TOKEN_COUNT_QUERY_KEY = ["tokenCount"] as const;

export function useCountTokens(chatId: number | null, input: string = "") {
  const queryClient = useQueryClient();

  const {
    data: result = null,
    isLoading: loading,
    error,
    refetch,
  } = useQuery<TokenCountResult | null>({
    queryKey: [...TOKEN_COUNT_QUERY_KEY, chatId, input],
    queryFn: async () => {
      if (chatId === null) return null;
      return IpcClient.getInstance().countTokens({ chatId, input });
    },
    enabled: chatId !== null,
  });

  // For imperative invalidation (e.g., after streaming completes)
  const invalidateTokenCount = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: TOKEN_COUNT_QUERY_KEY });
  }, [queryClient]);

  return {
    result,
    loading,
    error,
    refetch,
    invalidateTokenCount,
  };
}

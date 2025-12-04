import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { TokenCountResult } from "@/ipc/ipc_types";
import { useCallback, useEffect, useState } from "react";

export const TOKEN_COUNT_QUERY_KEY = ["tokenCount"] as const;

export function useCountTokens(chatId: number | null, input: string = "") {
  const queryClient = useQueryClient();

  // Debounce input so we don't call the token counting IPC on every keystroke.
  const [debouncedInput, setDebouncedInput] = useState(input);

  useEffect(() => {
    // If there's no chat, don't bother debouncing
    if (chatId === null) {
      setDebouncedInput(input);
      return;
    }

    const handle = setTimeout(() => {
      setDebouncedInput(input);
    }, 1_000);

    return () => clearTimeout(handle);
  }, [chatId, input]);

  const {
    data: result = null,
    isLoading: loading,
    error,
    refetch,
  } = useQuery<TokenCountResult | null>({
    queryKey: [...TOKEN_COUNT_QUERY_KEY, chatId, debouncedInput],
    queryFn: async () => {
      if (chatId === null) return null;
      return IpcClient.getInstance().countTokens({
        chatId,
        input: debouncedInput,
      });
    },
    placeholderData: keepPreviousData,
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

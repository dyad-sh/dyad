import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { LanguageModel } from "@/ipc/ipc_types";

/**
 * A hook to fetch the list of available language models for a specific provider.
 * @param {string | undefined} providerId - The ID of the language model provider.
 * @returns {import("@tanstack/react-query").UseQueryResult<LanguageModel[], Error>} The result of the query.
 */
export function useLanguageModelsForProvider(providerId: string | undefined) {
  const ipcClient = IpcClient.getInstance();

  return useQuery<
    LanguageModel[],
    Error // Specify Error type for better error handling
  >({
    queryKey: ["language-models", providerId],
    queryFn: async () => {
      if (!providerId) {
        // Avoid calling IPC if providerId is not set
        // Return an empty array as it's a query, not an error state
        return [];
      }
      return ipcClient.getLanguageModels({ providerId });
    },
    enabled: !!providerId,
  });
}

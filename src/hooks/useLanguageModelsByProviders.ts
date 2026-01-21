import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { LanguageModel } from "@/ipc/ipc_types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Fetches all available language models grouped by their provider IDs.
 *
 * @returns TanStack Query result object for the language models organized by provider.
 */
export function useLanguageModelsByProviders() {
  const ipcClient = IpcClient.getInstance();

  return useQuery<Record<string, LanguageModel[]>, Error>({
    queryKey: queryKeys.languageModels.byProviders,
    queryFn: async () => {
      return ipcClient.getLanguageModelsByProviders();
    },
  });
}

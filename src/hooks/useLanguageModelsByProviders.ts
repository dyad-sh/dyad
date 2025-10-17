import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { LanguageModel } from "@/ipc/ipc_types";

/**
 * A hook to fetch all available language models grouped by their provider IDs.
 * @returns {import("@tanstack/react-query").UseQueryResult<Record<string, LanguageModel[]>, Error>} The result of the query.
 */
export function useLanguageModelsByProviders() {
  const ipcClient = IpcClient.getInstance();

  return useQuery<Record<string, LanguageModel[]>, Error>({
    queryKey: ["language-models-by-providers"],
    queryFn: async () => {
      return ipcClient.getLanguageModelsByProviders();
    },
  });
}

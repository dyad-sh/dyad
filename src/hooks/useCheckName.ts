import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

/**
 * A hook to check if an app name already exists.
 * @param {string} appName - The name of the app to check.
 * @returns {import("@tanstack/react-query").UseQueryResult<{ exists: boolean }, unknown>} The result of the query.
 */
export const useCheckName = (appName: string) => {
  return useQuery({
    queryKey: ["checkAppName", appName],
    queryFn: async () => {
      const result = await IpcClient.getInstance().checkAppName({ appName });
      return result;
    },
    enabled: !!appName && !!appName.trim(),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
    staleTime: 300000, // 5 minutes
  });
};

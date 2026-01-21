import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { queryKeys } from "@/lib/queryKeys";

export const useCheckName = (appName: string) => {
  return useQuery({
    queryKey: queryKeys.appName.check(appName),
    queryFn: async () => {
      const result = await IpcClient.getInstance().checkAppName({ appName });
      return result;
    },
    enabled: !!appName && !!appName.trim(),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
  });
};

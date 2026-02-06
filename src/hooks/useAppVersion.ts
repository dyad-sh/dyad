import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useAppVersion() {
  const { data } = useQuery({
    queryKey: queryKeys.system.appVersion,
    queryFn: async () => {
      const result = await ipc.system.getAppVersion();
      return result.version;
    },
    staleTime: Infinity, // App version never changes during a session
  });

  return data ?? null;
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useLoadApps() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.apps.all,
    queryFn: async () => {
      const appListResponse = await ipc.app.listApps();
      return appListResponse.apps;
    },
  });

  const refreshApps = () => {
    return queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
  };

  return {
    apps: data ?? [],
    loading: isLoading,
    error: error ?? null,
    refreshApps,
  };
}

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { appsListAtom } from "@/atoms/appAtoms";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useLoadApps() {
  const [, setApps] = useAtom(appsListAtom);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.apps.all,
    queryFn: async () => {
      const appListResponse = await ipc.app.listApps();
      return appListResponse.apps;
    },
  });

  // Sync to Jotai atom for backward compatibility
  useEffect(() => {
    if (data !== undefined) {
      setApps(data);
    }
  }, [data, setApps]);

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

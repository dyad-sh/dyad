import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ipc,
  type VercelDriftStatus,
  type VercelSyncPlan,
  type VercelSyncResult,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useSyncPlan(
  appId: number | null,
  options: { enabled?: boolean } = {},
) {
  return useQuery<VercelSyncPlan, Error>({
    queryKey: queryKeys.vercel.syncPlan({ appId: appId ?? -1 }),
    queryFn: () => ipc.vercel.getSyncPlan({ appId: appId! }),
    enabled: appId !== null && (options.enabled ?? true),
    staleTime: 30 * 1000,
  });
}

export function useDriftStatus(appId: number | null) {
  return useQuery<VercelDriftStatus, Error>({
    queryKey: queryKeys.vercel.driftStatus({ appId: appId ?? -1 }),
    queryFn: () => ipc.vercel.getDriftStatus({ appId: appId! }),
    enabled: appId !== null,
    staleTime: 30 * 1000,
  });
}

export function useSyncToVercel(appId: number | null) {
  const queryClient = useQueryClient();
  return useMutation<VercelSyncResult, Error, void>({
    mutationFn: () => ipc.vercel.syncToVercel({ appId: appId! }),
    onSuccess: () => {
      if (appId === null) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.vercel.syncPlan({ appId }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.vercel.driftStatus({ appId }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.apps.detail({ appId }),
      });
    },
  });
}

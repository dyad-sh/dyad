import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { PublishToDeedPageParams } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function useDeedPageSite(appId: number) {
  return useQuery({
    queryKey: queryKeys.deedpage.site({ appId }),
    queryFn: () => ipc.deedpage.getSite({ appId }),
  });
}

export function usePublishToDeedPage(appId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Omit<PublishToDeedPageParams, "appId">) =>
      ipc.deedpage.publish({ appId, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.deedpage.site({ appId }),
      });
    },
  });
}

export function useDisconnectDeedPage(appId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.deedpage.disconnect({ appId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.deedpage.site({ appId }),
      });
    },
  });
}

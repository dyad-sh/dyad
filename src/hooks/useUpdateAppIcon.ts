import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { ListedApp, IconType } from "@/ipc/types/app";
import { showError, showSuccess } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

export function useUpdateAppIcon() {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    void,
    Error,
    { appId: number; iconType: IconType; iconData: string },
    { previousApps: ListedApp[] | undefined }
  >({
    mutationFn: async ({ appId, iconType, iconData }) => {
      await ipc.app.updateAppIcon({ appId, iconType, iconData });
    },
    onMutate: async ({ appId, iconType, iconData }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.apps.all });

      // Snapshot the previous value
      const previousApps = queryClient.getQueryData<ListedApp[]>(
        queryKeys.apps.all,
      );

      // Optimistically update the cache
      queryClient.setQueryData<ListedApp[]>(queryKeys.apps.all, (oldApps) =>
        oldApps?.map((app) =>
          app.id === appId ? { ...app, iconType, iconData } : app,
        ),
      );

      return { previousApps };
    },
    onSuccess: () => {
      showSuccess("App icon updated");
    },
    onError: (error, _, context) => {
      // Rollback on error
      if (context?.previousApps) {
        queryClient.setQueryData(queryKeys.apps.all, context.previousApps);
      }
      showError(error.message || "Failed to update app icon");
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
    },
  });

  return {
    updateIcon: mutation.mutate,
    updateIconAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
  };
}

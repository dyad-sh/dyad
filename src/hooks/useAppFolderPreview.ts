import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Resolves the exact folder name an app display name would produce
 * (lowercase slug plus any collision suffix), probed by the main process
 * against the database and filesystem. Pass `appId` when previewing a rename
 * so the app's own folder doesn't count as a collision.
 */
export const useAppFolderPreview = (appName: string, appId?: number) => {
  return useQuery({
    queryKey: queryKeys.appName.folderPreview({ name: appName, appId }),
    queryFn: async () => {
      const result = await ipc.app.previewAppFolderName({
        name: appName,
        appId,
      });
      return result.folderName;
    },
    enabled: !!appName && !!appName.trim(),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
  });
};

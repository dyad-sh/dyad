import { useQuery } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "./useSettings";

/**
 * Every image and video stored on this machine: the local file vault plus each
 * app's media folder. Independent of any cloud connection.
 */
export function useLocalMedia() {
  const { settings } = useSettings();
  const hasIpc = isIpcRendererAvailable();

  const query = useQuery({
    queryKey: queryKeys.media.local,
    queryFn: () => ipc.media.listLocalMedia(),
    enabled: hasIpc,
    // Files can appear from outside the app (drag into the vault in Finder),
    // so keep this fresh enough to notice them.
    staleTime: settings?.isTestMode ? 0 : 10_000,
  });

  return {
    items: query.data?.items ?? [],
    vaultPath: query.data?.vaultPath ?? null,
    isLoading: hasIpc && query.isLoading,
    error: query.error,
  };
}

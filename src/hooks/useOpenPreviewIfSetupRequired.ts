import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";

import { previewModeAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { ipc } from "@/ipc/types";
import type { NodeSystemInfo } from "@/ipc/types/system";
import { queryKeys } from "@/lib/queryKeys";

export function useOpenPreviewIfSetupRequired() {
  const previewMode = useAtomValue(previewModeAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);
  const queryClient = useQueryClient();

  return useCallback(
    async (appId: number | null | undefined) => {
      if (!appId || previewMode !== "preview") {
        return false;
      }

      try {
        const nodeSystemInfo = await queryClient.fetchQuery({
          queryKey: queryKeys.system.nodejsStatus,
          queryFn: () => ipc.system.getNodejsStatus(),
        });

        if (nodeSystemInfo.nodeVersion) {
          return false;
        }
      } catch (error) {
        const cachedNodeSystemInfo = queryClient.getQueryData<NodeSystemInfo>(
          queryKeys.system.nodejsStatus,
        );
        if (cachedNodeSystemInfo?.nodeVersion) {
          return false;
        }

        console.error(
          "Failed to check Node.js status before opening preview setup:",
          error,
        );
      }

      setIsPreviewOpen(true);
      return true;
    },
    [previewMode, queryClient, setIsPreviewOpen],
  );
}

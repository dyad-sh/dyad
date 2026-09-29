import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { TestRunQueueSnapshot } from "@/ipc/types/tests";
import { queryKeys } from "@/lib/queryKeys";

/** Read-only projection of the main-owned queue; the renderer never schedules it. */
export function useTestRunQueue(appId: number | null) {
  const queryClient = useQueryClient();
  const latestEvent = useRef<(TestRunQueueSnapshot & { appId: number }) | null>(
    null,
  );
  useEffect(
    () =>
      ipc.events.tests.onQueueState((snapshot) => {
        if (snapshot.appId !== appId) return;
        latestEvent.current = snapshot;
        queryClient.setQueryData(queryKeys.tests.queue({ appId }), snapshot);
      }),
    [appId, queryClient],
  );
  return useQuery({
    queryKey: queryKeys.tests.queue({ appId }),
    enabled: appId !== null,
    // Events are only observed while mounted; always refresh after leaving the tab.
    staleTime: 0,
    queryFn: async () => {
      const before = latestEvent.current;
      const snapshot = await ipc.tests.getRunQueue({ appId: appId! });
      const latest = latestEvent.current;
      // A complete event snapshot supersedes a bootstrap response captured earlier.
      return latest !== before && latest?.appId === appId ? latest : snapshot;
    },
  });
}

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/** Read-only projection of the main-owned queue; the renderer never schedules it. */
export function useTestRunQueue(appId: number | null) {
  const queryClient = useQueryClient();
  const changes = useRef(0);
  useEffect(
    () =>
      ipc.events.tests.onQueueState((snapshot) => {
        if (snapshot.appId !== appId) return;
        changes.current += 1;
        void queryClient.invalidateQueries({
          queryKey: queryKeys.tests.queue({ appId }),
        });
      }),
    [appId, queryClient],
  );
  return useQuery({
    queryKey: queryKeys.tests.queue({ appId }),
    enabled: appId !== null,
    queryFn: async () => {
      // An event can arrive while the initial IPC snapshot is in flight. In
      // that case fetch again instead of publishing the older bootstrap.
      for (;;) {
        const version = changes.current;
        const snapshot = await ipc.tests.getRunQueue({ appId: appId! });
        if (version === changes.current) return snapshot;
      }
    },
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import type { HelixStatus } from "@/ipc/types/helix";
import { queryKeys } from "@/lib/queryKeys";

/** Status + lifecycle controls for the embedded Helix coding agent server. */
export function useHelix() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: queryKeys.helix.status,
    queryFn: () => ipc.helix.getStatus(),
    // Poll fast while the dev server is booting, slowly otherwise.
    refetchInterval: (query) =>
      query.state.data?.state === "starting" ? 1_500 : 10_000,
  });

  const setStatus = (status: HelixStatus) => {
    queryClient.setQueryData(queryKeys.helix.status, status);
  };

  const startMutation = useMutation({
    mutationFn: () => ipc.helix.start(),
    onSuccess: setStatus,
  });

  const stopMutation = useMutation({
    mutationFn: () => ipc.helix.stop(),
    onSuccess: setStatus,
  });

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    start: startMutation.mutateAsync,
    isStartPending: startMutation.isPending,
    stop: stopMutation.mutateAsync,
    isStopPending: stopMutation.isPending,
  };
}

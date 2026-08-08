import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import type { OpenWorkerStatus } from "@/ipc/types/openworker";
import { queryKeys } from "@/lib/queryKeys";

/** Status + lifecycle controls for the embedded OpenWorker agent. */
export function useOpenWorker() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: queryKeys.openWorker.status,
    queryFn: () => ipc.openWorker.getStatus(),
    // Poll fast while the Python server is booting, slowly otherwise.
    refetchInterval: (query) =>
      query.state.data?.state === "starting" ? 1_500 : 10_000,
  });

  const setStatus = (status: OpenWorkerStatus) => {
    queryClient.setQueryData(queryKeys.openWorker.status, status);
  };

  const startMutation = useMutation({
    mutationFn: () => ipc.openWorker.start(),
    onSuccess: setStatus,
  });

  const stopMutation = useMutation({
    mutationFn: () => ipc.openWorker.stop(),
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

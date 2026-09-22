import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Whether Dyad is connected to a GitLab instance, and which. Never carries
 * the token; the main process keeps that to itself.
 */
export function useGitLabStatus() {
  const query = useQuery({
    queryKey: queryKeys.gitlab.status,
    queryFn: () => ipc.gitlab.getStatus(),
  });
  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

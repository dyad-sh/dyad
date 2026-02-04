import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

interface UseEdgeLogsParams {
  projectId: string | null;
  organizationSlug: string | null;
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useEdgeLogs({
  projectId,
  organizationSlug,
  enabled = true,
  refetchInterval = false,
}: UseEdgeLogsParams) {
  return useQuery({
    queryKey: queryKeys.supabase.edgeLogs({
      projectId: projectId ?? "",
      organizationSlug,
    }),
    queryFn: async () => {
      if (!projectId) {
        throw new Error("No project selected");
      }
      const result = await ipc.supabase.listEdgeLogs({
        projectId,
        organizationSlug,
      });
      return result.logs;
    },
    enabled: !!projectId && enabled,
    refetchInterval,
  });
}

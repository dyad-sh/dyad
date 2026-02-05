import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import type { GenericLogEntry, LogSource } from "@/ipc/types/supabase";

interface UseProjectLogsParams {
  projectId: string | null;
  organizationSlug: string | null;
  source: LogSource;
  enabled?: boolean;
  refetchInterval?: number | false;
}

export function useProjectLogs({
  projectId,
  organizationSlug,
  source,
  enabled = true,
  refetchInterval = false,
}: UseProjectLogsParams) {
  return useQuery<GenericLogEntry[], Error>({
    queryKey: queryKeys.supabase.projectLogs({
      projectId: projectId ?? "",
      organizationSlug,
      source,
    }),
    queryFn: async () => {
      const result = await ipc.supabase.listProjectLogs({
        projectId: projectId!,
        organizationSlug,
        source,
      });
      return result.logs;
    },
    enabled: !!projectId && enabled,
    refetchInterval,
  });
}

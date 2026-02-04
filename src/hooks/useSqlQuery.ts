import { useMutation } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { ExecuteSqlResult } from "@/ipc/types/supabase";

interface UseSqlQueryParams {
  projectId: string | null;
  organizationSlug: string | null;
}

/**
 * Hook to execute arbitrary SQL queries against a Supabase project.
 * Returns a mutation that can be triggered with a query string.
 */
export function useSqlQuery({
  projectId,
  organizationSlug,
}: UseSqlQueryParams) {
  return useMutation<ExecuteSqlResult, Error, string>({
    mutationFn: async (query: string) => {
      if (!projectId) {
        throw new Error("No project connected");
      }
      return ipc.supabase.executeSql({
        projectId,
        organizationSlug,
        query,
      });
    },
  });
}

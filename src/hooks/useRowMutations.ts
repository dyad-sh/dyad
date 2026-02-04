import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

interface UseRowMutationsParams {
  projectId: string | null;
  organizationSlug: string | null;
  table: string | null;
}

/**
 * Hook providing mutations for inserting, updating, and deleting rows.
 * Automatically invalidates table rows query on success.
 */
export function useRowMutations({
  projectId,
  organizationSlug,
  table,
}: UseRowMutationsParams) {
  const queryClient = useQueryClient();

  const invalidateRows = () => {
    if (projectId && table) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.supabase.tables({ projectId, organizationSlug }),
      });
      // Invalidate all row queries for this table (any pagination)
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) &&
            key[0] === "supabase" &&
            key[1] === "rows" &&
            key[2] === projectId &&
            key[4] === table
          );
        },
      });
    }
  };

  const insertMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (!projectId || !table) {
        throw new Error("No project or table selected");
      }
      return ipc.supabase.insertRow({
        projectId,
        organizationSlug,
        table,
        data,
      });
    },
    onSuccess: invalidateRows,
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      primaryKey,
      data,
    }: {
      primaryKey: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (!projectId || !table) {
        throw new Error("No project or table selected");
      }
      return ipc.supabase.updateRow({
        projectId,
        organizationSlug,
        table,
        primaryKey,
        data,
      });
    },
    onSuccess: invalidateRows,
  });

  const deleteMutation = useMutation({
    mutationFn: async (primaryKey: Record<string, unknown>) => {
      if (!projectId || !table) {
        throw new Error("No project or table selected");
      }
      return ipc.supabase.deleteRow({
        projectId,
        organizationSlug,
        table,
        primaryKey,
      });
    },
    onSuccess: invalidateRows,
  });

  return {
    insertRow: insertMutation,
    updateRow: updateMutation,
    deleteRow: deleteMutation,
  };
}

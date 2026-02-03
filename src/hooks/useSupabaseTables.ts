import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { ipc } from "@/ipc/types";
import type { TableColumn, QueryTableRowsResult } from "@/ipc/types/supabase";

interface UseSupabaseConnectionParams {
  projectId: string | null;
  organizationSlug: string | null;
}

/**
 * Hook to fetch the list of tables from a Supabase project.
 * Only enabled when projectId is provided.
 */
export function useSupabaseTables({
  projectId,
  organizationSlug,
}: UseSupabaseConnectionParams) {
  return useQuery<string[], Error>({
    queryKey: queryKeys.supabase.tables({
      projectId: projectId ?? "",
      organizationSlug,
    }),
    queryFn: () =>
      ipc.supabase.listTables({ projectId: projectId!, organizationSlug }),
    enabled: !!projectId,
  });
}

/**
 * Hook to fetch the schema (columns) for a specific table.
 * Only enabled when both projectId and table are provided.
 */
export function useSupabaseSchema({
  projectId,
  organizationSlug,
  table,
}: UseSupabaseConnectionParams & { table: string | null }) {
  return useQuery<TableColumn[], Error>({
    queryKey: queryKeys.supabase.schema({
      projectId: projectId ?? "",
      organizationSlug,
      table: table ?? "",
    }),
    queryFn: () =>
      ipc.supabase.getTableSchema({
        projectId: projectId!,
        organizationSlug,
        table: table!,
      }),
    enabled: !!projectId && !!table,
  });
}

/**
 * Hook to fetch rows from a specific table with pagination.
 * Only enabled when both projectId and table are provided.
 * Query key includes limit and offset to ensure correct caching.
 */
export function useSupabaseRows({
  projectId,
  organizationSlug,
  table,
  limit,
  offset,
}: UseSupabaseConnectionParams & {
  table: string | null;
  limit: number;
  offset: number;
}) {
  return useQuery<QueryTableRowsResult, Error>({
    queryKey: queryKeys.supabase.rows({
      projectId: projectId ?? "",
      organizationSlug,
      table: table ?? "",
      limit,
      offset,
    }),
    queryFn: () =>
      ipc.supabase.queryTableRows({
        projectId: projectId!,
        organizationSlug,
        table: table!,
        limit,
        offset,
      }),
    enabled: !!projectId && !!table,
  });
}

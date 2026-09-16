import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

/** Refreshes every query that reflects the set of configured plugins. */
export async function invalidateMcpQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers }),
    queryClient.invalidateQueries({ queryKey: queryKeys.mcp.catalog }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.mcp.toolsByServer.all,
    }),
  ]);
}

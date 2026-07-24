import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

// Shared read of the curated MCP catalog. Every caller uses the same
// query key, so TanStack dedups them into one fetch and one cache entry.
// Cache a populated catalog for an hour, but expire an empty result
// quickly so a transient fetch failure doesn't hide it until remount.
export function useMcpCatalog() {
  return useQuery({
    queryKey: queryKeys.mcp.catalog,
    queryFn: () => ipc.mcp.listCatalog(),
    staleTime: (query) =>
      query.state.data?.entries.length ? 60 * 60 * 1000 : 30 * 1000,
    refetchOnWindowFocus: false,
  });
}

import { useQuery } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import {
  buildHealthRows,
  summariseHealth,
} from "@/lib/dashboard/system_health";
import { buildConnectedServices } from "@/lib/dashboard/connected_services";

/**
 * Everything the dashboard shows, read from the screens that already own it.
 *
 * No new state is kept here. Each query is the same one its own screen runs, so
 * opening the dashboard warms the caches those screens use rather than
 * duplicating them, and a failure shows as unknown rather than as health.
 */
export function useDashboardState() {
  const { settings } = useSettings();
  const { data: providers, isProviderSetup } = useLanguageModelProviders();

  // Infrastructure reads its saved snapshot; it does not start a scan, which is
  // the expensive part and belongs to its own screen.
  const infrastructure = useQuery({
    queryKey: ["dashboard", "infrastructure"],
    queryFn: () => ipc.infrastructure.snapshot(),
    staleTime: 60_000,
  });

  const dataSources = useQuery({
    queryKey: ["dashboard", "data-sources"],
    queryFn: () => ipc.dataSource.list(),
    staleTime: 60_000,
  });

  const storage = useQuery({
    queryKey: ["dashboard", "storage"],
    queryFn: () => ipc.storage.status(),
    staleTime: 60_000,
  });

  const vector = useQuery({
    queryKey: ["dashboard", "vector"],
    queryFn: () => ipc.vector.getOverview(),
    staleTime: 60_000,
  });

  const mcp = useQuery({
    queryKey: queryKeys.mcp.servers,
    queryFn: () => ipc.mcp.listServers(),
    staleTime: 60_000,
  });

  const configuredProviders = (providers ?? []).filter((provider) =>
    isProviderSetup(provider.id),
  );

  const rows = buildHealthRows({
    infrastructure: infrastructure.data
      ? {
          healthy: infrastructure.data.summary.healthy,
          degraded: infrastructure.data.summary.degraded,
          offline: infrastructure.data.summary.offline,
          total: infrastructure.data.summary.total,
        }
      : null,
    providers: providers ? { configured: configuredProviders.length } : null,
    dataSources: dataSources.data
      ? {
          total: dataSources.data.length,
          connected: dataSources.data.filter(
            (source) => source.status === "connected",
          ).length,
          errored: dataSources.data.filter((source) =>
            source.status.endsWith("_error"),
          ).length,
        }
      : null,
    storage: storage.data
      ? {
          localVaultReady: storage.data.localVaultReady,
          cloudConnected: storage.data.cloudConnected,
        }
      : null,
    vector: vector.data
      ? {
          state: vector.data.status.state,
          message: vector.data.status.message,
        }
      : null,
  });

  const services = buildConnectedServices({
    settings,
    providers: configuredProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
    })),
    mcpServerCount: mcp.data?.length ?? null,
    dataSourceCount: dataSources.data?.length ?? null,
  });

  return {
    health: rows,
    overall: summariseHealth(rows),
    services,
    // The vector service is the only subsystem that already keeps an activity
    // log, so it is the only honest source for the activity panel.
    activity: vector.data?.activity ?? [],
    isLoading:
      infrastructure.isLoading ||
      dataSources.isLoading ||
      storage.isLoading ||
      vector.isLoading,
  };
}

/** Current place and weather. Null throughout when they cannot be had. */
export function useDashboardConditions() {
  return useQuery({
    queryKey: ["dashboard", "conditions"],
    queryFn: () => ipc.dashboard.conditions(),
    // Weather does not change minute to minute, and this is a background
    // detail on a home screen, not a forecast app.
    staleTime: 15 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
}

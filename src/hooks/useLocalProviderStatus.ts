import { useQuery } from "@tanstack/react-query";

import { ipc, type DiscoveredLocalModelServer } from "@/ipc/types";
import {
  DEFAULT_LM_STUDIO_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  isLocalProviderId,
  parseLMStudioBaseUrl,
  parseOllamaBaseUrl,
} from "@/lib/local_provider_utils";
import { DEFAULT_MX_SERVE_BASE_URL, parseMxServeBaseUrl } from "@/lib/mx_serve";
import { queryKeys } from "@/lib/queryKeys";

export type LocalProviderConnectionStatus = "checking" | "online" | "offline";

function normalizedTarget(providerId: string, serverUrl?: string): string {
  if (providerId === "lmstudio") {
    return parseLMStudioBaseUrl(
      serverUrl?.trim() || DEFAULT_LM_STUDIO_BASE_URL,
    );
  }
  if (providerId === "ollama") {
    return parseOllamaBaseUrl(serverUrl?.trim() || DEFAULT_OLLAMA_BASE_URL);
  }
  if (providerId === "mx_serve") {
    return parseMxServeBaseUrl(serverUrl?.trim() || DEFAULT_MX_SERVE_BASE_URL);
  }
  return serverUrl?.trim() ?? "";
}

export function useLocalProviderStatus(
  providerId: string,
  serverUrl?: string,
): {
  status: LocalProviderConnectionStatus;
  server?: DiscoveredLocalModelServer;
  refresh: () => Promise<unknown>;
} {
  const isLocal = isLocalProviderId(providerId);
  const target = normalizedTarget(providerId, serverUrl);
  const query = useQuery({
    queryKey: queryKeys.languageModels.localStatus({
      providerId,
      serverUrl: target,
    }),
    queryFn: async () => {
      const result = await ipc.languageModel.discoverLocalServers({
        scanLocalSubnet: false,
        targets: [target],
      });
      return result.servers.find(
        (server) =>
          server.provider === providerId &&
          normalizedTarget(providerId, server.url) === target,
      );
    },
    enabled: isLocal,
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  return {
    status:
      query.isPending || (query.isFetching && query.data === undefined)
        ? "checking"
        : query.data
          ? "online"
          : "offline",
    server: query.data,
    refresh: query.refetch,
  };
}

export function useLocalProviderDiscovery(targets: string[]) {
  const targetsKey = targets
    .map((target) => target.trim())
    .filter(Boolean)
    .sort()
    .join("|");
  return useQuery({
    queryKey: queryKeys.languageModels.localDiscovery({
      targets: targetsKey ? targetsKey.split("|") : [],
    }),
    queryFn: () =>
      ipc.languageModel.discoverLocalServers({
        scanLocalSubnet: true,
        targets: targetsKey ? targetsKey.split("|") : [],
      }),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

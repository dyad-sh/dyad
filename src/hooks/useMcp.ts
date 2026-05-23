import { useMemo } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type {
  McpServer,
  McpServerUpdate,
  McpTool,
  McpToolConsent,
  CreateMcpServer,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export type Transport = "stdio" | "http" | "sse";

export function useMcp() {
  const queryClient = useQueryClient();

  const serversQuery = useQuery<McpServer[], Error>({
    queryKey: queryKeys.mcp.servers,
    queryFn: async () => {
      const list = await ipc.mcp.listServers();
      return (list || []) as McpServer[];
    },
    meta: { showErrorToast: true },
  });

  const serverIds = useMemo(
    () => (serversQuery.data || []).map((s) => s.id).sort((a, b) => a - b),
    [serversQuery.data],
  );

  const toolsByServerQuery = useQuery<Record<number, McpTool[]>, Error>({
    queryKey: queryKeys.mcp.toolsByServer.list({ serverIds }),
    enabled: serverIds.length > 0,
    queryFn: async () => {
      // Promise.allSettled (not all) so one server's listTools
      // rejection doesn't poison the batch -- an unconnected
      // OAuth-gated server can hang on its 401 path, which would
      // otherwise hold every other server's tools hostage. The
      // handler-side timeout caps the worst case; this is the
      // renderer-side safety net.
      const settled = await Promise.allSettled(
        serverIds.map(async (id) => [id, await ipc.mcp.listTools(id)] as const),
      );
      const entries = settled.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      return Object.fromEntries(entries) as Record<number, McpTool[]>;
    },
    // `serverIds` is part of the query key, so adding/removing a
    // server makes React Query see a brand-new query. keepPreviousData
    // keeps existing servers' tools visible while the new key loads.
    placeholderData: keepPreviousData,
    meta: { showErrorToast: true },
  });

  const consentsQuery = useQuery<McpToolConsent[], Error>({
    queryKey: queryKeys.mcp.consents,
    queryFn: async () => {
      const list = await ipc.mcp.getToolConsents();
      return (list || []) as McpToolConsent[];
    },
    meta: { showErrorToast: true },
  });

  const consentsMap = useMemo(() => {
    const map: Record<string, McpToolConsent["consent"]> = {};
    for (const c of consentsQuery.data || []) {
      map[`${c.serverId}:${c.toolName}`] = c.consent;
    }
    return map;
  }, [consentsQuery.data]);

  const createServerMutation = useMutation({
    mutationFn: async (params: CreateMcpServer) => {
      return ipc.mcp.createServer(params);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.toolsByServer.all,
      });
    },
    meta: { showErrorToast: true },
  });

  const updateServerMutation = useMutation({
    mutationFn: async (params: McpServerUpdate) => {
      return ipc.mcp.updateServer(params);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.toolsByServer.all,
      });
    },
    meta: { showErrorToast: true },
  });

  const deleteServerMutation = useMutation({
    mutationFn: async (id: number) => {
      return ipc.mcp.deleteServer(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.toolsByServer.all,
      });
    },
    meta: { showErrorToast: true },
  });

  const startOAuthMutation = useMutation({
    mutationFn: async (params: { serverId: number }) => {
      return ipc.mcp.startOAuth(params);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.mcp.toolsByServer.all,
        }),
      ]);
    },
    meta: { showErrorToast: true },
  });

  const disconnectOAuthMutation = useMutation({
    mutationFn: async (serverId: number) => {
      return ipc.mcp.disconnectOAuth(serverId);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.mcp.toolsByServer.all,
        }),
      ]);
    },
    meta: { showErrorToast: true },
  });

  const setConsentMutation = useMutation({
    mutationFn: async (params: {
      serverId: number;
      toolName: string;
      consent: McpToolConsent["consent"];
    }) => {
      return ipc.mcp.setToolConsent(params);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.consents });
    },
    meta: { showErrorToast: true },
  });

  const createServer = async (params: CreateMcpServer) =>
    createServerMutation.mutateAsync(params);

  const toggleEnabled = async (id: number, currentEnabled: boolean) =>
    updateServerMutation.mutateAsync({ id, enabled: !currentEnabled });

  const updateServer = async (params: McpServerUpdate) =>
    updateServerMutation.mutateAsync(params);

  const deleteServer = async (id: number) =>
    deleteServerMutation.mutateAsync(id);

  const setToolConsent = async (
    serverId: number,
    toolName: string,
    consent: McpToolConsent["consent"],
  ) => setConsentMutation.mutateAsync({ serverId, toolName, consent });

  const startOAuth = async (params: { serverId: number }) =>
    startOAuthMutation.mutateAsync(params);

  const disconnectOAuth = async (serverId: number) =>
    disconnectOAuthMutation.mutateAsync(serverId);

  const refetchAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.toolsByServer.all,
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.consents }),
    ]);
  };

  return {
    servers: serversQuery.data || [],
    toolsByServer: toolsByServerQuery.data || {},
    consentsList: consentsQuery.data || [],
    consentsMap,
    isLoading:
      serversQuery.isLoading ||
      toolsByServerQuery.isLoading ||
      consentsQuery.isLoading,
    error:
      serversQuery.error || toolsByServerQuery.error || consentsQuery.error,
    refetchAll,

    // Mutations
    createServer,
    toggleEnabled,
    updateServer,
    deleteServer,
    setToolConsent,
    startOAuth,
    disconnectOAuth,

    // Status flags
    isCreating: createServerMutation.isPending,
    isToggling: updateServerMutation.isPending,
    isUpdatingServer: updateServerMutation.isPending,
    isDeleting: deleteServerMutation.isPending,
    isSettingConsent: setConsentMutation.isPending,
    isStartingOAuth: startOAuthMutation.isPending,
    isDisconnectingOAuth: disconnectOAuthMutation.isPending,
  } as const;
}

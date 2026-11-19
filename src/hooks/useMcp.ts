import { useMemo } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type {
  McpAppConfig,
  McpAppConfigUpdate,
  McpConnectionConfig,
  McpServer,
  McpServerUpdate,
  McpTool,
  McpToolConsent,
  CreateMcpServer,
  McpListToolsResult,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useSettings } from "@/hooks/useSettings";
import {
  mcpConnectionKey,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";

export type Transport = "stdio" | "http";

/**
 * Fields an edit can change on a configuration. `enabled` is the plugin's
 * switch, so it only applies to a plugin's default configuration.
 */
export type McpConnectionEdit = Omit<McpServerUpdate, "id">;

/** Key into `consentsMap` for one tool of one configuration. */
export function mcpConsentKey(
  connection: McpConnectionRef,
  toolName: string,
): string {
  return `${mcpConnectionKey(connection)}/${toolName}`;
}

export function useMcp() {
  const queryClient = useQueryClient();
  // App-specific configurations only exist for the user while the
  // experiment is on; with it off, none are listed or connected to.
  const { settings, settingsLoading } = useSettings();
  const appScopedPluginsEnabled = !!settings?.enableAppScopedPlugins;

  const serversQuery = useQuery<McpServer[], Error>({
    queryKey: queryKeys.mcp.servers,
    queryFn: async () => {
      const list = await ipc.mcp.listServers();
      return (list || []) as McpServer[];
    },
    meta: { showErrorToast: true },
  });

  const appConfigsQuery = useQuery<McpAppConfig[], Error>({
    queryKey: queryKeys.mcp.appConfigs,
    queryFn: () => ipc.mcp.listAppConfigs(),
    enabled: appScopedPluginsEnabled,
    meta: { showErrorToast: true },
  });
  const appConfigs = useMemo(
    () => (appScopedPluginsEnabled ? (appConfigsQuery.data ?? []) : []),
    [appScopedPluginsEnabled, appConfigsQuery.data],
  );

  const connections = useMemo<McpConnectionConfig[]>(
    () => [...(serversQuery.data || []), ...appConfigs],
    [serversQuery.data, appConfigs],
  );

  // Tools and their status are keyed by mcpConnectionKey, so a plugin and
  // each of its app-specific configurations have their own entries.
  const connectionKeys = useMemo(
    () =>
      connections.map((config) => mcpConnectionKey(config.connection)).sort(),
    [connections],
  );

  const toolsByServerQuery = useQuery<
    Record<string, McpListToolsResult>,
    Error
  >({
    queryKey: queryKeys.mcp.toolsByServer.list({ connectionKeys }),
    // Waits for settings, which decide whether app-specific configurations
    // are listed, so the batch isn't run once without them and again with.
    enabled:
      !settingsLoading &&
      !(appScopedPluginsEnabled && appConfigsQuery.isLoading) &&
      connectionKeys.length > 0,
    queryFn: async () => {
      // Promise.allSettled (not all) so one server's listTools
      // rejection doesn't fail the whole batch. The handler returns a
      // per-server status for its own errors; a rejection here is rare
      // (IPC-level) and that server is simply omitted from the map.
      const settled = await Promise.allSettled(
        connections.map(
          async (config) =>
            [
              mcpConnectionKey(config.connection),
              await ipc.mcp.listTools(config.connection),
            ] as const,
        ),
      );
      const entries = settled.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      return Object.fromEntries(entries) as Record<string, McpListToolsResult>;
    },
    // `connectionKeys` is part of the query key, so adding/removing a
    // server makes React Query see a brand-new query. keepPreviousData
    // keeps existing servers' tools visible while the new key loads.
    placeholderData: keepPreviousData,
    // Avoid re-probing on every window focus; connect/disconnect and
    // CRUD mutations already invalidate this query. A focus refetch
    // would otherwise hit the listTools timeout on unconnected OAuth
    // servers on each return to the app.
    refetchOnWindowFocus: false,
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

  const toolsByServer = useMemo(() => {
    const map: Record<string, McpTool[]> = {};
    for (const [id, result] of Object.entries(toolsByServerQuery.data || {})) {
      // A failed or unauthorized listing has no real tool list, only a
      // placeholder empty array. Leave the server out so absence means
      // "no successful discovery" and the UI shows a placeholder count
      // instead of a misleading zero; the outcome itself is reported
      // via statusByServer.
      if (result.status === "ok") {
        map[id] = result.tools;
      }
    }
    return map;
  }, [toolsByServerQuery.data]);

  const statusByServer = useMemo(() => {
    const map: Record<string, McpListToolsResult["status"]> = {};
    for (const [id, result] of Object.entries(toolsByServerQuery.data || {})) {
      map[id] = result.status;
    }
    return map;
  }, [toolsByServerQuery.data]);

  const errorByServer = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [id, result] of Object.entries(toolsByServerQuery.data || {})) {
      if (result.status !== "ok" && result.errorMessage) {
        map[id] = result.errorMessage;
      }
    }
    return map;
  }, [toolsByServerQuery.data]);

  const consentsMap = useMemo(() => {
    const map: Record<string, McpToolConsent["consent"]> = {};
    for (const c of consentsQuery.data || []) {
      map[
        mcpConsentKey(
          { serverId: c.serverId, appConfigId: c.appConfigId },
          c.toolName,
        )
      ] = c.consent;
    }
    return map;
  }, [consentsQuery.data]);

  const invalidateServers = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.servers }),
      queryClient.invalidateQueries({ queryKey: queryKeys.mcp.appConfigs }),
    ]);

  const invalidateServersAndTools = async () => {
    await invalidateServers();
    await queryClient.invalidateQueries({
      queryKey: queryKeys.mcp.toolsByServer.all,
    });
  };

  const createAppConfigMutation = useMutation({
    mutationFn: (params: {
      serverId: number;
      name: string;
      appIds: number[];
    }) => ipc.mcp.createAppConfig(params),
    onSuccess: invalidateServersAndTools,
    meta: { showErrorToast: true },
  });

  const setAppConfigAppsMutation = useMutation({
    mutationFn: (params: {
      serverId: number;
      appConfigId: number;
      appIds: number[];
    }) => ipc.mcp.setAppConfigApps(params),
    onSuccess: invalidateServersAndTools,
    meta: { showErrorToast: true },
  });

  const setPluginAvailabilityMutation = useMutation({
    mutationFn: (params: {
      serverId: number;
      defaultScope: McpServer["defaultScope"];
      defaultAppIds: number[];
    }) => ipc.mcp.setPluginAvailability(params),
    onSuccess: invalidateServersAndTools,
    meta: { showErrorToast: true },
  });

  const createServerMutation = useMutation({
    mutationFn: async (params: CreateMcpServer) => {
      return ipc.mcp.createServer(params);
    },
    onSuccess: async () => {
      await invalidateServers();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.toolsByServer.all,
      });
    },
    meta: { showErrorToast: true },
  });

  // Drops a configuration's cached probe result before re-discovering, so a
  // status from before an edit (e.g. a 401 from before its key was saved)
  // can't briefly show as a failure. The batched query keeps previous data
  // through a refetch, which would otherwise retain it.
  const refreshEditedConnection = async (connection: McpConnectionRef) => {
    const key = mcpConnectionKey(connection);
    queryClient.setQueriesData<Record<string, McpListToolsResult>>(
      { queryKey: queryKeys.mcp.toolsByServer.all },
      (old) => {
        if (!old || !(key in old)) return old;
        const next = { ...old };
        delete next[key];
        return next;
      },
    );
    await invalidateServersAndTools();
  };

  const updateServerMutation = useMutation({
    mutationFn: async (params: McpServerUpdate) => {
      return ipc.mcp.updateServer(params);
    },
    onSuccess: (_result, params) =>
      refreshEditedConnection({ serverId: params.id, appConfigId: null }),
    meta: { showErrorToast: true },
  });

  const updateAppConfigMutation = useMutation({
    mutationFn: (params: McpAppConfigUpdate) => ipc.mcp.updateAppConfig(params),
    onSuccess: (_result, params) =>
      refreshEditedConnection({
        serverId: params.serverId,
        appConfigId: params.appConfigId,
      }),
    meta: { showErrorToast: true },
  });

  const deleteAppConfigMutation = useMutation({
    mutationFn: (params: { serverId: number; appConfigId: number }) =>
      ipc.mcp.deleteAppConfig(params),
    onSuccess: async () => {
      await invalidateServersAndTools();
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.catalog });
    },
    meta: { showErrorToast: true },
  });

  const deleteServerMutation = useMutation({
    mutationFn: async (id: number) => {
      return ipc.mcp.deleteServer(id);
    },
    onSuccess: async () => {
      await invalidateServers();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.mcp.toolsByServer.all,
      });
      // A deleted catalog plugin becomes addable again.
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcp.catalog });
    },
    meta: { showErrorToast: true },
  });

  const startOAuthMutation = useMutation({
    mutationFn: async (params: {
      connection: McpConnectionRef;
      rendererMessageId: string;
      callbackPort?: number;
    }) => {
      return ipc.mcp.startOAuth(params);
    },
    onSuccess: async () => {
      await Promise.all([
        invalidateServers(),
        queryClient.invalidateQueries({
          queryKey: queryKeys.mcp.toolsByServer.all,
        }),
      ]);
    },
    meta: { showErrorToast: true },
  });

  const disconnectOAuthMutation = useMutation({
    mutationFn: async (connection: McpConnectionRef) => {
      return ipc.mcp.disconnectOAuth(connection);
    },
    onSuccess: async () => {
      await Promise.all([
        invalidateServers(),
        queryClient.invalidateQueries({
          queryKey: queryKeys.mcp.toolsByServer.all,
        }),
      ]);
    },
    // onDisconnect shows its own error toast, so no global one here.
  });

  const setConsentMutation = useMutation({
    mutationFn: async (params: {
      connection: McpConnectionRef;
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

  // Edits either kind of configuration through its own channel.
  const updateConnection = async (
    connection: McpConnectionRef,
    edit: McpConnectionEdit,
  ): Promise<void> => {
    if (connection.appConfigId === null) {
      await updateServerMutation.mutateAsync({
        id: connection.serverId,
        ...edit,
      });
      return;
    }
    const { enabled, ...configEdit } = edit;
    if (enabled !== undefined) {
      throw new Error(
        "An app-specific configuration is turned on and off with its plugin.",
      );
    }
    await updateAppConfigMutation.mutateAsync({
      serverId: connection.serverId,
      appConfigId: connection.appConfigId,
      ...configEdit,
    });
  };

  const deleteServer = async (id: number) =>
    deleteServerMutation.mutateAsync(id);

  const setToolConsent = async (
    connection: McpConnectionRef,
    toolName: string,
    consent: McpToolConsent["consent"],
  ) => setConsentMutation.mutateAsync({ connection, toolName, consent });

  const startOAuth = async (params: {
    connection: McpConnectionRef;
    callbackPort?: number;
  }) =>
    startOAuthMutation.mutateAsync({
      ...params,
      rendererMessageId: crypto.randomUUID(),
    });

  const disconnectOAuth = async (connection: McpConnectionRef) =>
    disconnectOAuthMutation.mutateAsync(connection);

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
    appConfigs,
    /** Every connectable configuration: plugins and app-specific ones. */
    connections,
    appScopedPluginsEnabled,
    toolsByServer,
    statusByServer,
    errorByServer,
    consentsList: consentsQuery.data || [],
    consentsMap,
    isLoading:
      serversQuery.isLoading ||
      toolsByServerQuery.isLoading ||
      consentsQuery.isLoading,
    // Tool discovery connects to live servers and can take seconds
    // (LIST_TOOLS_TIMEOUT_MS), while the servers query is a local DB
    // read. Callers that render per-server placeholders for pending
    // tool counts gate on this instead of `isLoading`.
    isServersLoading: serversQuery.isLoading,
    isAppConfigsLoading: appScopedPluginsEnabled && appConfigsQuery.isLoading,
    appConfigsFailed: appScopedPluginsEnabled && appConfigsQuery.isError,
    error:
      serversQuery.error || toolsByServerQuery.error || consentsQuery.error,
    refetchAll,

    // Mutations
    createServer,
    toggleEnabled,
    updateServer,
    updateConnection,
    deleteServer,
    deleteAppConfig: deleteAppConfigMutation.mutateAsync,
    setToolConsent,
    startOAuth,
    disconnectOAuth,
    createAppConfig: createAppConfigMutation.mutateAsync,
    setAppConfigApps: setAppConfigAppsMutation.mutateAsync,
    setPluginAvailability: setPluginAvailabilityMutation.mutateAsync,

    // Status flags
    isCreating: createServerMutation.isPending,
    isToggling: updateServerMutation.isPending,
    isUpdatingServer:
      updateServerMutation.isPending || updateAppConfigMutation.isPending,
    isDeleting:
      deleteServerMutation.isPending || deleteAppConfigMutation.isPending,
    isSettingConsent: setConsentMutation.isPending,
    isStartingOAuth: startOAuthMutation.isPending,
    isDisconnectingOAuth: disconnectOAuthMutation.isPending,
    isSavingAppScope:
      createAppConfigMutation.isPending ||
      setAppConfigAppsMutation.isPending ||
      updateAppConfigMutation.isPending ||
      setPluginAvailabilityMutation.isPending,
  } as const;
}

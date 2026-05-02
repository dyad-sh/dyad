import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type {
  McpServer,
  McpServerStatusInfo,
  McpServerUpdate,
  McpTool,
  McpToolConsent,
  CreateMcpServer,
} from "@/ipc/ipc_types";

export type Transport = "stdio" | "http";
export type { McpServerStatusInfo };

export function useMcp() {
  const queryClient = useQueryClient();

  const serversQuery = useQuery<McpServer[], Error>({
    queryKey: ["mcp", "servers"],
    queryFn: async () => {
      const ipc = IpcClient.getInstance();
      const list = await ipc.listMcpServers();
      return (list || []) as McpServer[];
    },
    meta: { showErrorToast: true },
  });

  const serverIds = useMemo(
    () => (serversQuery.data || []).map((s) => s.id).sort((a, b) => a - b),
    [serversQuery.data],
  );

  const toolsByServerQuery = useQuery<Record<number, McpTool[]>, Error>({
    queryKey: ["mcp", "tools-by-server", serverIds],
    enabled: serverIds.length > 0,
    queryFn: async () => {
      const ipc = IpcClient.getInstance();
      const entries = await Promise.all(
        serverIds.map(async (id) => [id, await ipc.listMcpTools(id)] as const),
      );
      return Object.fromEntries(entries) as Record<number, McpTool[]>;
    },
    meta: { showErrorToast: true },
  });

  const consentsQuery = useQuery<McpToolConsent[], Error>({
    queryKey: ["mcp", "consents"],
    queryFn: async () => {
      const ipc = IpcClient.getInstance();
      const list = await ipc.getMcpToolConsents();
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
      const ipc = IpcClient.getInstance();
      return ipc.createMcpServer(params);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp", "servers"] });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tools-by-server"],
      });
      // Shared picker (McpToolPicker) caches the cross-server catalog
      // separately. Invalidate it so newly-installed servers show up
      // immediately instead of after the 60s staleTime.
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tool-catalog"],
      });
    },
    meta: { showErrorToast: true },
  });

  const updateServerMutation = useMutation({
    mutationFn: async (params: McpServerUpdate) => {
      const ipc = IpcClient.getInstance();
      return ipc.updateMcpServer(params);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp", "servers"] });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tools-by-server"],
      });
      // Toggling enabled / renaming a server changes which tools the
      // catalog should expose, so refresh the picker cache too.
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tool-catalog"],
      });
    },
    meta: { showErrorToast: true },
  });

  const deleteServerMutation = useMutation({
    mutationFn: async (id: number) => {
      const ipc = IpcClient.getInstance();
      return ipc.deleteMcpServer(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp", "servers"] });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tools-by-server"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tool-catalog"],
      });
    },
    meta: { showErrorToast: true },
  });

  const setConsentMutation = useMutation({
    mutationFn: async (params: {
      serverId: number;
      toolName: string;
      consent: McpToolConsent["consent"];
    }) => {
      const ipc = IpcClient.getInstance();
      return ipc.setMcpToolConsent(params);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp", "consents"] });
    },
    meta: { showErrorToast: true },
  });

  // ─── Status ────────────────────────────────────────────────────────
  const statusByServerQuery = useQuery<
    Record<number, McpServerStatusInfo>,
    Error
  >({
    queryKey: ["mcp", "statuses"],
    queryFn: async () => {
      const ipc = IpcClient.getInstance();
      const list = await ipc.getAllMcpStatuses();
      const map: Record<number, McpServerStatusInfo> = {};
      for (const s of list ?? []) map[s.serverId] = s;
      return map;
    },
    meta: { showErrorToast: true },
  });

  useEffect(() => {
    const ipc = IpcClient.getInstance();
    const unsubscribe = ipc.onMcpStatusChange((info) => {
      queryClient.setQueryData<Record<number, McpServerStatusInfo>>(
        ["mcp", "statuses"],
        (prev) => ({ ...(prev ?? {}), [info.serverId]: info }),
      );
    });
    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  // ─── Resources ─────────────────────────────────────────────────────
  const connectedServerIds = useMemo(
    () =>
      serverIds.filter(
        (id) => statusByServerQuery.data?.[id]?.status === "connected",
      ),
    [serverIds, statusByServerQuery.data],
  );

  const resourcesByServerQuery = useQuery<
    Record<number, { resources: any[]; templates: any[] }>,
    Error
  >({
    queryKey: ["mcp", "resources-by-server", connectedServerIds],
    enabled: connectedServerIds.length > 0,
    queryFn: async () => {
      const ipc = IpcClient.getInstance();
      const settled = await Promise.allSettled(
        connectedServerIds.map(async (id) => {
          const [resources, templates] = await Promise.all([
            ipc
              .listMcpResources(id)
              .catch(() => [] as unknown[]),
            ipc
              .listMcpResourceTemplates(id)
              .catch(() => [] as unknown[]),
          ]);
          return [id, { resources, templates }] as const;
        }),
      );
      const out: Record<number, { resources: any[]; templates: any[] }> = {};
      for (const r of settled) {
        if (r.status === "fulfilled") {
          const [id, val] = r.value;
          out[id] = val as { resources: any[]; templates: any[] };
        }
      }
      return out;
    },
    meta: { showErrorToast: true },
  });

  // ─── Prompts ───────────────────────────────────────────────────────
  const promptsByServerQuery = useQuery<Record<number, any[]>, Error>({
    queryKey: ["mcp", "prompts-by-server", connectedServerIds],
    enabled: connectedServerIds.length > 0,
    queryFn: async () => {
      const ipc = IpcClient.getInstance();
      const settled = await Promise.allSettled(
        connectedServerIds.map(async (id) => {
          const prompts = await ipc.listMcpPrompts(id).catch(() => []);
          return [id, prompts] as const;
        }),
      );
      const out: Record<number, any[]> = {};
      for (const r of settled) {
        if (r.status === "fulfilled") {
          const [id, val] = r.value;
          out[id] = val as any[];
        }
      }
      return out;
    },
    meta: { showErrorToast: true },
  });

  // ─── Action mutations ──────────────────────────────────────────────
  const callToolMutation = useMutation({
    mutationFn: async (params: {
      serverId: number;
      name: string;
      args?: unknown;
    }) => IpcClient.getInstance().callMcpTool(params),
    meta: { showErrorToast: true },
  });

  const readResourceMutation = useMutation({
    mutationFn: async (params: { serverId: number; uri: string }) =>
      IpcClient.getInstance().readMcpResource(params),
    meta: { showErrorToast: true },
  });

  const getPromptMutation = useMutation({
    mutationFn: async (params: {
      serverId: number;
      name: string;
      args?: Record<string, string>;
    }) => IpcClient.getInstance().getMcpPrompt(params),
    meta: { showErrorToast: true },
  });

  const connectMutation = useMutation({
    mutationFn: async (serverId: number) =>
      IpcClient.getInstance().connectMcpServer(serverId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp", "statuses"] });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tools-by-server"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tool-catalog"],
      });
    },
    meta: { showErrorToast: true },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (serverId: number) =>
      IpcClient.getInstance().disconnectMcpServer(serverId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp", "statuses"] });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tool-catalog"],
      });
    },
    meta: { showErrorToast: true },
  });

  const reconnectMutation = useMutation({
    mutationFn: async (serverId: number) =>
      IpcClient.getInstance().reconnectMcpServer(serverId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp", "statuses"] });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tools-by-server"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "resources-by-server"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "prompts-by-server"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["mcp", "tool-catalog"],
      });
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

  const refetchAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mcp", "servers"] }),
      queryClient.invalidateQueries({ queryKey: ["mcp", "tools-by-server"] }),
      queryClient.invalidateQueries({ queryKey: ["mcp", "consents"] }),
      queryClient.invalidateQueries({ queryKey: ["mcp", "statuses"] }),
      queryClient.invalidateQueries({
        queryKey: ["mcp", "resources-by-server"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["mcp", "prompts-by-server"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["mcp", "tool-catalog"],
      }),
    ]);
  };

  return {
    servers: serversQuery.data || [],
    toolsByServer: toolsByServerQuery.data || {},
    consentsList: consentsQuery.data || [],
    consentsMap,
    statusByServer: statusByServerQuery.data || {},
    resourcesByServer: resourcesByServerQuery.data || {},
    promptsByServer: promptsByServerQuery.data || {},
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

    // Action mutations
    callTool: (params: { serverId: number; name: string; args?: unknown }) =>
      callToolMutation.mutateAsync(params),
    readResource: (params: { serverId: number; uri: string }) =>
      readResourceMutation.mutateAsync(params),
    getPrompt: (params: {
      serverId: number;
      name: string;
      args?: Record<string, string>;
    }) => getPromptMutation.mutateAsync(params),
    connectServer: (serverId: number) =>
      connectMutation.mutateAsync(serverId),
    disconnectServer: (serverId: number) =>
      disconnectMutation.mutateAsync(serverId),
    reconnectServer: (serverId: number) =>
      reconnectMutation.mutateAsync(serverId),
    reconnectAll: async (ids: number[]) => {
      await Promise.allSettled(
        ids.map((id) =>
          IpcClient.getInstance().reconnectMcpServer(id),
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mcp", "statuses"] }),
        queryClient.invalidateQueries({
          queryKey: ["mcp", "tools-by-server"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["mcp", "resources-by-server"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["mcp", "prompts-by-server"],
        }),
      ]);
    },

    // Status flags
    isCreating: createServerMutation.isPending,
    isToggling: updateServerMutation.isPending,
    isUpdatingServer: updateServerMutation.isPending,
    isDeleting: deleteServerMutation.isPending,
    isSettingConsent: setConsentMutation.isPending,
    isCallingTool: callToolMutation.isPending,
    isReadingResource: readResourceMutation.isPending,
    isGettingPrompt: getPromptMutation.isPending,
    isConnecting: connectMutation.isPending,
    isReconnecting: reconnectMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
  } as const;
}

export function useMcpServer(serverId: number) {
  const mcp = useMcp();
  const server = mcp.servers.find((s) => s.id === serverId);
  const status: McpServerStatusInfo = mcp.statusByServer[serverId] ?? {
    serverId,
    status: "disconnected",
  };
  return {
    server,
    status,
    tools: mcp.toolsByServer[serverId] ?? [],
    resources: mcp.resourcesByServer[serverId]?.resources ?? [],
    resourceTemplates:
      mcp.resourcesByServer[serverId]?.templates ?? [],
    prompts: mcp.promptsByServer[serverId] ?? [],
    callTool: (name: string, args?: unknown) =>
      mcp.callTool({ serverId, name, args }),
    readResource: (uri: string) => mcp.readResource({ serverId, uri }),
    getPrompt: (name: string, args?: Record<string, string>) =>
      mcp.getPrompt({ serverId, name, args }),
    connect: () => mcp.connectServer(serverId),
    disconnect: () => mcp.disconnectServer(serverId),
    reconnect: () => mcp.reconnectServer(serverId),
    setConsent: (toolName: string, consent: McpToolConsent["consent"]) =>
      mcp.setToolConsent(serverId, toolName, consent),
  } as const;
}

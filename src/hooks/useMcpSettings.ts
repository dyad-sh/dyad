import { IpcClient } from "@/ipc/ipc_client";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

type McpServer = any; // TODO: add a proper type if/when available
type McpTool = any; // TODO: add a proper type if/when available

export function useMcpSettings() {
  const queryClient = useQueryClient();
  const ipc = IpcClient.getInstance();

  // Servers list
  const serversQuery = useQuery<McpServer[]>({
    queryKey: ["mcp", "servers"],
    queryFn: async () => ipc.listMcpServers(),
    meta: { showErrorToast: true },
  });

  const servers = serversQuery.data ?? [];

  // Tools per server (parallel)
  const toolsQueries = useQueries({
    queries: (servers ?? []).map((server) => ({
      queryKey: ["mcp", "tools", server.id],
      queryFn: async (): Promise<McpTool[]> => ipc.listMcpTools(server.id),
      enabled: Boolean(server?.id),
      meta: { showErrorToast: true },
    })),
  }) as UseQueryResult<McpTool[], unknown>[];

  const toolsByServer: Record<number, McpTool[]> = {};
  servers.forEach((server, index) => {
    toolsByServer[server.id] = toolsQueries[index]?.data ?? [];
  });

  // Consents
  const consentsQuery = useQuery({
    queryKey: ["mcp", "consents"],
    queryFn: async () => ipc.getMcpToolConsents(),
    select: (consents: any[] | undefined) => {
      const map: Record<string, any> = {};
      for (const c of consents || []) {
        map[`${c.serverId}:${c.toolName}`] = c.consent;
      }
      return map as Record<string, "ask" | "always" | "denied">;
    },
    meta: { showErrorToast: true },
  });

  // Mutations
  const createServer = useMutation({
    mutationFn: async (params: {
      name: string;
      transport: "stdio" | "http";
      command?: string | null;
      args?: string[] | null;
      url?: string | null;
      enabled?: boolean;
    }) => ipc.createMcpServer(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "servers"] });
    },
    meta: { showErrorToast: true },
  });

  const updateServer = useMutation({
    mutationFn: async (params: {
      id: number;
      name?: string;
      transport?: string;
      command?: string | null;
      args?: string[] | null;
      url?: string | null;
      enabled?: boolean;
    }) => ipc.updateMcpServer(params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "servers"] });
      if (variables?.id) {
        queryClient.invalidateQueries({
          queryKey: ["mcp", "tools", variables.id],
        });
      }
    },
    meta: { showErrorToast: true },
  });

  const deleteServer = useMutation({
    mutationFn: async (id: number) => ipc.deleteMcpServer(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "servers"] });
      queryClient.removeQueries({ queryKey: ["mcp", "tools", id] });
    },
    meta: { showErrorToast: true },
  });

  const setToolConsent = useMutation({
    mutationFn: async (params: {
      serverId: number;
      toolName: string;
      consent: "ask" | "always" | "denied";
    }) => ipc.setMcpToolConsent(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "consents"] });
    },
    meta: { showErrorToast: true },
  });

  const isLoading =
    serversQuery.isLoading ||
    consentsQuery.isLoading ||
    toolsQueries.some((q) => q.isLoading);

  return {
    // Data
    servers,
    toolsByServer,
    consents:
      consentsQuery.data ?? ({} as Record<string, "ask" | "always" | "denied">),
    isLoading,
    // Mutations
    createServer: createServer.mutateAsync,
    updateServer: updateServer.mutateAsync,
    deleteServer: deleteServer.mutateAsync,
    setToolConsent: setToolConsent.mutateAsync,
    // Utilities
    refetchServers: serversQuery.refetch,
    refetchConsents: consentsQuery.refetch,
  } as const;
}

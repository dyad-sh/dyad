import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/ipc/types";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import { queryKeys } from "@/lib/queryKeys";
import type {
  AgentOsAgentDto,
  CreateAgentOsAgent,
  UpdateAgentOsAgent,
} from "@/ipc/types";
import type { Agent } from "@/pages/agent-os/data";

function relativeTime(date: Date | null): string {
  if (!date) return "never";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/** Map the persisted DTO into the shape the Agent OS views consume. */
export function dtoToAgent(dto: AgentOsAgentDto): Agent {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    type: dto.type,
    endpoint: dto.endpoint,
    imageBaseUrl: dto.imageBaseUrl,
    model: dto.model,
    status: dto.status,
    capabilities: dto.capabilities,
    icon: dto.icon,
    lastActivity: relativeTime(dto.lastActivityAt ?? dto.updatedAt),
    taskCount: dto.taskCount,
    enabled: dto.enabled,
    hasApiKey: dto.hasApiKey,
  };
}

export function useAgentOsAgents() {
  const queryClient = useQueryClient();
  const hasIpcRenderer = isIpcRendererAvailable();

  const listQuery = useQuery({
    queryKey: queryKeys.agentOs.agents,
    queryFn: async (): Promise<Agent[]> => {
      const rows = await ipc.agentOs.list();
      return rows.map(dtoToAgent);
    },
    enabled: hasIpcRenderer,
    meta: { showErrorToast: true },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.agentOs.all });

  const createMutation = useMutation({
    mutationFn: async (params: CreateAgentOsAgent): Promise<Agent> => {
      return dtoToAgent(await ipc.agentOs.create(params));
    },
    onSuccess: invalidate,
    meta: { showErrorToast: true },
  });

  const updateMutation = useMutation({
    mutationFn: async (params: UpdateAgentOsAgent): Promise<Agent> => {
      return dtoToAgent(await ipc.agentOs.update(params));
    },
    onSuccess: (updatedAgent) => {
      queryClient.setQueryData<Agent[]>(
        queryKeys.agentOs.agents,
        (currentAgents) =>
          currentAgents?.map((agent) =>
            agent.id === updatedAgent.id ? updatedAgent : agent,
          ),
      );
      return invalidate();
    },
    meta: { showErrorToast: true },
  });

  const toggleMutation = useMutation({
    mutationFn: async (params: {
      id: string;
      enabled: boolean;
    }): Promise<Agent> => {
      return dtoToAgent(await ipc.agentOs.toggle(params));
    },
    onSuccess: invalidate,
    meta: { showErrorToast: true },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      return ipc.agentOs.delete(id);
    },
    onSuccess: invalidate,
    meta: { showErrorToast: true },
  });

  return {
    agents: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    refetch: listQuery.refetch,
    createAgent: createMutation.mutateAsync,
    updateAgent: updateMutation.mutateAsync,
    toggleAgent: toggleMutation.mutateAsync,
    deleteAgent: deleteMutation.mutateAsync,
    isMutating:
      createMutation.isPending ||
      updateMutation.isPending ||
      toggleMutation.isPending ||
      deleteMutation.isPending,
  };
}

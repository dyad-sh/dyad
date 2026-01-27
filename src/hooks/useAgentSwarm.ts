/**
 * Agent Swarm React Hooks
 * TanStack Query hooks for the self-replicating agent system
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  agentSwarmClient,
  type SwarmId,
  type AgentNodeId,
  type WitnessId,
  type KnowledgeId,
  type Swarm,
  type AgentNode,
  type Witness,
  type SharedKnowledge,
  type SwarmConfig,
  type SpawnRequest,
  type ReplicationRequest,
  type WitnessMode,
  type MessageType,
  type KnowledgeType,
  type TaskAssignment,
  type SwarmEvent,
} from "@/ipc/agent_swarm_client";

// =============================================================================
// QUERY KEYS
// =============================================================================

const SWARM_KEYS = {
  all: ["agent-swarm"] as const,
  swarms: () => [...SWARM_KEYS.all, "swarms"] as const,
  swarm: (id: SwarmId) => [...SWARM_KEYS.swarms(), id] as const,
  swarmStats: (id: SwarmId) => [...SWARM_KEYS.swarm(id), "stats"] as const,
  swarmEvents: (id: SwarmId) => [...SWARM_KEYS.swarm(id), "events"] as const,
  agents: (swarmId: SwarmId) => [...SWARM_KEYS.swarm(swarmId), "agents"] as const,
  agent: (id: AgentNodeId) => [...SWARM_KEYS.all, "agent", id] as const,
  agentStats: (id: AgentNodeId) => [...SWARM_KEYS.agent(id), "stats"] as const,
  agentChildren: (id: AgentNodeId) => [...SWARM_KEYS.agent(id), "children"] as const,
  agentLineage: (id: AgentNodeId) => [...SWARM_KEYS.agent(id), "lineage"] as const,
  witnesses: (agentId?: AgentNodeId) => [...SWARM_KEYS.all, "witnesses", agentId] as const,
  witness: (id: WitnessId) => [...SWARM_KEYS.all, "witness", id] as const,
  replications: (agentId?: AgentNodeId) => [...SWARM_KEYS.all, "replications", agentId] as const,
  messages: (agentId?: AgentNodeId, swarmId?: SwarmId) =>
    [...SWARM_KEYS.all, "messages", agentId, swarmId] as const,
  knowledge: (swarmId: SwarmId) => [...SWARM_KEYS.swarm(swarmId), "knowledge"] as const,
  knowledgeItem: (id: KnowledgeId) => [...SWARM_KEYS.all, "knowledge", id] as const,
  knowledgeSearch: (swarmId: SwarmId, query: string, type?: KnowledgeType) =>
    [...SWARM_KEYS.knowledge(swarmId), "search", query, type] as const,
};

// =============================================================================
// INITIALIZATION HOOKS
// =============================================================================

export function useInitializeSwarm() {
  return useMutation({
    mutationFn: () => agentSwarmClient.initialize(),
  });
}

export function useShutdownSwarm() {
  return useMutation({
    mutationFn: () => agentSwarmClient.shutdown(),
  });
}

// =============================================================================
// SWARM HOOKS
// =============================================================================

export function useSwarms() {
  return useQuery({
    queryKey: SWARM_KEYS.swarms(),
    queryFn: () => agentSwarmClient.listSwarms(),
  });
}

export function useSwarm(swarmId: SwarmId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.swarm(swarmId!),
    queryFn: () => agentSwarmClient.getSwarm(swarmId!),
    enabled: !!swarmId,
  });
}

export function useSwarmStats(swarmId: SwarmId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.swarmStats(swarmId!),
    queryFn: () => agentSwarmClient.getSwarmStats(swarmId!),
    enabled: !!swarmId,
    refetchInterval: 5000, // Refresh stats every 5s
  });
}

export function useSwarmRecentEvents(swarmId: SwarmId | undefined, limit = 100) {
  return useQuery({
    queryKey: SWARM_KEYS.swarmEvents(swarmId!),
    queryFn: () => agentSwarmClient.getRecentEvents(swarmId!, limit),
    enabled: !!swarmId,
    refetchInterval: 2000, // Refresh events every 2s
  });
}

export function useCreateSwarm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      name,
      description,
      config,
    }: {
      name: string;
      description?: string;
      config?: Partial<SwarmConfig>;
    }) => agentSwarmClient.createSwarm(name, description, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarms() });
    },
  });
}

export function useUpdateSwarm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      swarmId,
      updates,
    }: {
      swarmId: SwarmId;
      updates: Partial<{ name: string; description: string; config: Partial<SwarmConfig> }>;
    }) => agentSwarmClient.updateSwarm(swarmId, updates),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarm(data.id) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarms() });
    },
  });
}

export function useStartSwarm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (swarmId: SwarmId) => agentSwarmClient.startSwarm(swarmId),
    onSuccess: (_, swarmId) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarm(swarmId) });
    },
  });
}

export function usePauseSwarm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (swarmId: SwarmId) => agentSwarmClient.pauseSwarm(swarmId),
    onSuccess: (_, swarmId) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarm(swarmId) });
    },
  });
}

export function useTerminateSwarm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (swarmId: SwarmId) => agentSwarmClient.terminateSwarm(swarmId),
    onSuccess: (_, swarmId) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarm(swarmId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agents(swarmId) });
    },
  });
}

export function useDeleteSwarm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (swarmId: SwarmId) => agentSwarmClient.deleteSwarm(swarmId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarms() });
    },
  });
}

// =============================================================================
// AGENT HOOKS
// =============================================================================

export function useAgents(swarmId: SwarmId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.agents(swarmId!),
    queryFn: () => agentSwarmClient.listAgents(swarmId!),
    enabled: !!swarmId,
  });
}

export function useAgent(agentId: AgentNodeId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.agent(agentId!),
    queryFn: () => agentSwarmClient.getAgent(agentId!),
    enabled: !!agentId,
  });
}

export function useAgentStats(agentId: AgentNodeId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.agentStats(agentId!),
    queryFn: () => agentSwarmClient.getAgentStats(agentId!),
    enabled: !!agentId,
    refetchInterval: 5000,
  });
}

export function useAgentChildren(agentId: AgentNodeId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.agentChildren(agentId!),
    queryFn: () => agentSwarmClient.getAgentChildren(agentId!),
    enabled: !!agentId,
  });
}

export function useAgentLineage(agentId: AgentNodeId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.agentLineage(agentId!),
    queryFn: () => agentSwarmClient.getAgentLineage(agentId!),
    enabled: !!agentId,
  });
}

export function useSpawnAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      swarmId,
      request,
      parentId,
    }: {
      swarmId: SwarmId;
      request: SpawnRequest;
      parentId?: AgentNodeId;
    }) => agentSwarmClient.spawnAgent(swarmId, request, parentId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agents(data.swarmId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarmStats(data.swarmId) });
      if (data.parentId) {
        queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agentChildren(data.parentId) });
      }
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      updates,
    }: {
      agentId: AgentNodeId;
      updates: Partial<{ name: string; config: any; resources: any }>;
    }) => agentSwarmClient.updateAgent(agentId, updates),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(data.id) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agents(data.swarmId) });
    },
  });
}

export function useStartAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: AgentNodeId) => agentSwarmClient.startAgent(agentId),
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(agentId) });
    },
  });
}

export function useStopAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: AgentNodeId) => agentSwarmClient.stopAgent(agentId),
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(agentId) });
    },
  });
}

export function useTerminateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: AgentNodeId) => agentSwarmClient.terminateAgent(agentId),
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.all });
    },
  });
}

// =============================================================================
// REPLICATION HOOKS
// =============================================================================

export function useReplications(agentId?: AgentNodeId) {
  return useQuery({
    queryKey: SWARM_KEYS.replications(agentId),
    queryFn: () => agentSwarmClient.listReplications(agentId),
  });
}

export function useReplicateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      request,
    }: {
      agentId: AgentNodeId;
      request: ReplicationRequest;
    }) => agentSwarmClient.replicateAgent(agentId, request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agents(data.swarmId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.replications() });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agentChildren(data.parentId!) });
    },
  });
}

// =============================================================================
// WITNESS HOOKS
// =============================================================================

export function useWitnesses(agentId?: AgentNodeId) {
  return useQuery({
    queryKey: SWARM_KEYS.witnesses(agentId),
    queryFn: () => agentSwarmClient.listWitnesses(agentId),
  });
}

export function useWitness(witnessId: WitnessId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.witness(witnessId!),
    queryFn: () => agentSwarmClient.getWitness(witnessId!),
    enabled: !!witnessId,
  });
}

export function useStartWitness() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      observerId,
      targetId,
      mode,
    }: {
      observerId: AgentNodeId;
      targetId: AgentNodeId;
      mode: WitnessMode;
    }) => agentSwarmClient.startWitness(observerId, targetId, mode),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.witnesses() });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(data.observerId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(data.targetId) });
    },
  });
}

export function useRecordObservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      witnessId,
      eventType,
      data,
      analysis,
    }: {
      witnessId: WitnessId;
      eventType: string;
      data: unknown;
      analysis?: string;
    }) => agentSwarmClient.recordObservation(witnessId, eventType, data, analysis),
    onSuccess: (_, { witnessId }) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.witness(witnessId) });
    },
  });
}

export function useAddWitnessInsight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      witnessId,
      type,
      content,
      confidence,
      sourceObservationIds,
    }: {
      witnessId: WitnessId;
      type: KnowledgeType;
      content: string;
      confidence: number;
      sourceObservationIds: string[];
    }) =>
      agentSwarmClient.addWitnessInsight(
        witnessId,
        type,
        content,
        confidence,
        sourceObservationIds
      ),
    onSuccess: (_, { witnessId }) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.witness(witnessId) });
    },
  });
}

export function useEndWitness() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (witnessId: WitnessId) => agentSwarmClient.endWitness(witnessId),
    onSuccess: (_, witnessId) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.witness(witnessId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.witnesses() });
    },
  });
}

// =============================================================================
// TASK HOOKS
// =============================================================================

export function useAssignTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      task,
    }: {
      agentId: AgentNodeId;
      task: Omit<TaskAssignment, "id" | "status" | "createdAt">;
    }) => agentSwarmClient.assignTask(agentId, task),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(agentId) });
    },
  });
}

export function useDelegateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      fromAgentId,
      toAgentId,
      taskId,
    }: {
      fromAgentId: AgentNodeId;
      toAgentId: AgentNodeId;
      taskId: string;
    }) => agentSwarmClient.delegateTask(fromAgentId, toAgentId, taskId),
    onSuccess: (_, { fromAgentId, toAgentId }) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(fromAgentId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(toAgentId) });
    },
  });
}

export function useCompleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      taskId,
      output,
    }: {
      agentId: AgentNodeId;
      taskId: string;
      output: unknown;
    }) => agentSwarmClient.completeTask(agentId, taskId, output),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.all });
    },
  });
}

export function useFailTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      taskId,
      error,
    }: {
      agentId: AgentNodeId;
      taskId: string;
      error: string;
    }) => agentSwarmClient.failTask(agentId, taskId, error),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(agentId) });
    },
  });
}

// =============================================================================
// MESSAGING HOOKS
// =============================================================================

export function useMessages(agentId?: AgentNodeId, swarmId?: SwarmId) {
  return useQuery({
    queryKey: SWARM_KEYS.messages(agentId, swarmId),
    queryFn: () => agentSwarmClient.listMessages(agentId, swarmId),
    refetchInterval: 2000,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      senderId,
      recipientId,
      swarmId,
      type,
      payload,
      options,
    }: {
      senderId: AgentNodeId | "system";
      recipientId: AgentNodeId | "broadcast";
      swarmId: SwarmId;
      type: MessageType;
      payload: unknown;
      options?: { priority?: number; requiresAck?: boolean };
    }) => agentSwarmClient.sendMessage(senderId, recipientId, swarmId, type, payload, options),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.messages(undefined, data.swarmId) });
    },
  });
}

export function useAcknowledgeMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (messageId: string) =>
      agentSwarmClient.acknowledgeMessage(messageId as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.messages() });
    },
  });
}

// =============================================================================
// KNOWLEDGE HOOKS
// =============================================================================

export function useKnowledge(swarmId: SwarmId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.knowledge(swarmId!),
    queryFn: () => agentSwarmClient.listKnowledge(swarmId!),
    enabled: !!swarmId,
  });
}

export function useKnowledgeItem(knowledgeId: KnowledgeId | undefined) {
  return useQuery({
    queryKey: SWARM_KEYS.knowledgeItem(knowledgeId!),
    queryFn: () => agentSwarmClient.getKnowledge(knowledgeId!),
    enabled: !!knowledgeId,
  });
}

export function useSearchKnowledge(
  swarmId: SwarmId | undefined,
  query: string,
  type?: KnowledgeType
) {
  return useQuery({
    queryKey: SWARM_KEYS.knowledgeSearch(swarmId!, query, type),
    queryFn: () => agentSwarmClient.searchKnowledge(swarmId!, query, type),
    enabled: !!swarmId && query.length > 0,
  });
}

export function useShareKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      contributorId,
      type,
      content,
      metadata,
    }: {
      contributorId: AgentNodeId;
      type: KnowledgeType;
      content: string;
      metadata?: Record<string, unknown>;
    }) => agentSwarmClient.shareKnowledge(contributorId, type, content, metadata),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.knowledge(data.swarmId) });
    },
  });
}

export function useApplyKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      knowledgeId,
    }: {
      agentId: AgentNodeId;
      knowledgeId: KnowledgeId;
    }) => agentSwarmClient.applyKnowledge(agentId, knowledgeId),
    onSuccess: (_, { agentId, knowledgeId }) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.knowledgeItem(knowledgeId) });
    },
  });
}

export function useRateKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      knowledgeId,
      rating,
    }: {
      knowledgeId: KnowledgeId;
      rating: number;
    }) => agentSwarmClient.rateKnowledge(knowledgeId, rating),
    onSuccess: (_, { knowledgeId }) => {
      queryClient.invalidateQueries({ queryKey: SWARM_KEYS.knowledgeItem(knowledgeId) });
    },
  });
}

// =============================================================================
// EVENT SUBSCRIPTION HOOK
// =============================================================================

export function useSwarmEvents(callback?: (event: SwarmEvent) => void) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<SwarmEvent | null>(null);

  useEffect(() => {
    // Subscribe to events
    agentSwarmClient.subscribe().catch(console.error);

    const unsubscribe = agentSwarmClient.onEvent((event) => {
      setEvents((prev) => [event, ...prev].slice(0, 1000)); // Keep last 1000 events
      setLatestEvent(event);

      // Call custom callback
      callback?.(event);

      // Invalidate relevant queries based on event type
      switch (event.type) {
        case "swarm:created":
        case "swarm:terminated":
          queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarms() });
          break;
        case "swarm:started":
        case "swarm:paused":
          queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarm(event.swarmId) });
          break;
        case "agent:spawned":
        case "agent:terminated":
          queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agents(event.swarmId) });
          queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarmStats(event.swarmId) });
          break;
        case "agent:replicated":
          queryClient.invalidateQueries({ queryKey: SWARM_KEYS.replications() });
          break;
        case "task:completed":
        case "task:failed":
          queryClient.invalidateQueries({ queryKey: SWARM_KEYS.swarmStats(event.swarmId) });
          if (event.agentId) {
            queryClient.invalidateQueries({ queryKey: SWARM_KEYS.agent(event.agentId) });
          }
          break;
        case "knowledge:shared":
          queryClient.invalidateQueries({ queryKey: SWARM_KEYS.knowledge(event.swarmId) });
          break;
        case "witness:insight":
          queryClient.invalidateQueries({ queryKey: SWARM_KEYS.witnesses() });
          break;
      }
    });

    return () => {
      unsubscribe();
      agentSwarmClient.unsubscribe().catch(console.error);
    };
  }, [callback, queryClient]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  return { events, latestEvent, clearEvents };
}

// =============================================================================
// COMBINED MANAGER HOOK
// =============================================================================

export function useAgentSwarmManager(swarmId?: SwarmId) {
  const queryClient = useQueryClient();

  // Queries
  const swarmsQuery = useSwarms();
  const swarmQuery = useSwarm(swarmId);
  const agentsQuery = useAgents(swarmId);
  const statsQuery = useSwarmStats(swarmId);
  const knowledgeQuery = useKnowledge(swarmId);

  // Mutations
  const createSwarm = useCreateSwarm();
  const startSwarm = useStartSwarm();
  const pauseSwarm = usePauseSwarm();
  const terminateSwarm = useTerminateSwarm();
  const deleteSwarm = useDeleteSwarm();

  const spawnAgent = useSpawnAgent();
  const replicateAgent = useReplicateAgent();
  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();
  const terminateAgent = useTerminateAgent();

  const startWitness = useStartWitness();
  const endWitness = useEndWitness();

  const assignTask = useAssignTask();
  const delegateTask = useDelegateTask();
  const completeTask = useCompleteTask();

  const sendMessage = useSendMessage();
  const shareKnowledge = useShareKnowledge();

  // Events
  const { events, latestEvent } = useSwarmEvents();

  // Refresh all data
  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: SWARM_KEYS.all });
  }, [queryClient]);

  return {
    // Data
    swarms: swarmsQuery.data ?? [],
    swarm: swarmQuery.data,
    agents: agentsQuery.data ?? [],
    stats: statsQuery.data,
    knowledge: knowledgeQuery.data ?? [],
    events,
    latestEvent,

    // Loading states
    isLoading:
      swarmsQuery.isLoading ||
      swarmQuery.isLoading ||
      agentsQuery.isLoading,

    // Swarm actions
    createSwarm: createSwarm.mutateAsync,
    startSwarm: startSwarm.mutateAsync,
    pauseSwarm: pauseSwarm.mutateAsync,
    terminateSwarm: terminateSwarm.mutateAsync,
    deleteSwarm: deleteSwarm.mutateAsync,

    // Agent actions
    spawnAgent: spawnAgent.mutateAsync,
    replicateAgent: replicateAgent.mutateAsync,
    startAgent: startAgent.mutateAsync,
    stopAgent: stopAgent.mutateAsync,
    terminateAgent: terminateAgent.mutateAsync,

    // Witness actions
    startWitness: startWitness.mutateAsync,
    endWitness: endWitness.mutateAsync,

    // Task actions
    assignTask: assignTask.mutateAsync,
    delegateTask: delegateTask.mutateAsync,
    completeTask: completeTask.mutateAsync,

    // Communication
    sendMessage: sendMessage.mutateAsync,
    shareKnowledge: shareKnowledge.mutateAsync,

    // Utilities
    refreshAll,
  };
}

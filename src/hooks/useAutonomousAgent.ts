/**
 * Autonomous Agent React Hooks
 * TanStack Query hooks for the fully autonomous AI system
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useCallback } from "react";
import {
  autonomousAgentClient,
  type AutonomousAgentId,
  type MissionId,
  type ArtifactId,
  type AutonomousAgent,
  type Mission,
  type Artifact,
  type MissionType,
  type AgentConfiguration,
  type AgentPerformanceMetrics,
  type AutonomousAgentEvent,
} from "@/ipc/autonomous_agent_client";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const AUTONOMOUS_KEYS = {
  all: ["autonomous-agent"] as const,
  
  // Agents
  agents: () => [...AUTONOMOUS_KEYS.all, "agents"] as const,
  agent: (id: AutonomousAgentId) => [...AUTONOMOUS_KEYS.agents(), id] as const,
  agentStats: (id: AutonomousAgentId) => [...AUTONOMOUS_KEYS.agent(id), "stats"] as const,
  agentEvents: (id: AutonomousAgentId) => [...AUTONOMOUS_KEYS.agent(id), "events"] as const,
  
  // Missions
  missions: () => [...AUTONOMOUS_KEYS.all, "missions"] as const,
  mission: (id: MissionId) => [...AUTONOMOUS_KEYS.missions(), id] as const,
  agentMissions: (agentId: AutonomousAgentId) => [...AUTONOMOUS_KEYS.missions(), "agent", agentId] as const,
  
  // Artifacts
  artifacts: () => [...AUTONOMOUS_KEYS.all, "artifacts"] as const,
  artifact: (id: ArtifactId) => [...AUTONOMOUS_KEYS.artifacts(), id] as const,
  missionArtifacts: (missionId: MissionId) => [...AUTONOMOUS_KEYS.artifacts(), "mission", missionId] as const,
};

// =============================================================================
// INITIALIZATION HOOKS
// =============================================================================

export function useInitializeAutonomousSystem() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => autonomousAgentClient.initialize(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.all });
    },
  });
}

export function useShutdownAutonomousSystem() {
  return useMutation({
    mutationFn: () => autonomousAgentClient.shutdown(),
  });
}

// =============================================================================
// AGENT HOOKS
// =============================================================================

export function useAutonomousAgents() {
  return useQuery({
    queryKey: AUTONOMOUS_KEYS.agents(),
    queryFn: () => autonomousAgentClient.listAgents(),
    refetchInterval: 5000, // Refresh every 5s
  });
}

export function useAutonomousAgent(agentId: AutonomousAgentId | undefined) {
  return useQuery({
    queryKey: AUTONOMOUS_KEYS.agent(agentId!),
    queryFn: () => autonomousAgentClient.getAgent(agentId!),
    enabled: !!agentId,
    refetchInterval: 2000, // Refresh every 2s for active agents
  });
}

export function useAgentStats(agentId: AutonomousAgentId | undefined) {
  return useQuery({
    queryKey: AUTONOMOUS_KEYS.agentStats(agentId!),
    queryFn: () => autonomousAgentClient.getAgentStats(agentId!),
    enabled: !!agentId,
    refetchInterval: 3000,
  });
}

export function useCreateAutonomousAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: {
      name: string;
      purpose: string;
      config?: Partial<AgentConfiguration>;
      parentId?: AutonomousAgentId;
    }) => autonomousAgentClient.createAgent(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agents() });
    },
  });
}

export function useActivateAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (agentId: AutonomousAgentId) => autonomousAgentClient.activateAgent(agentId),
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agents() });
    },
  });
}

export function useTerminateAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (agentId: AutonomousAgentId) => autonomousAgentClient.terminateAgent(agentId),
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agents() });
    },
  });
}

export function useReplicateAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ agentId, specialization }: { 
      agentId: AutonomousAgentId; 
      specialization?: string;
    }) => autonomousAgentClient.replicateAgent(agentId, specialization),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agents() });
    },
  });
}

// =============================================================================
// MISSION HOOKS
// =============================================================================

export function useMissions(agentId?: AutonomousAgentId) {
  return useQuery({
    queryKey: agentId ? AUTONOMOUS_KEYS.agentMissions(agentId) : AUTONOMOUS_KEYS.missions(),
    queryFn: () => autonomousAgentClient.listMissions(agentId),
    refetchInterval: 3000,
  });
}

export function useMission(missionId: MissionId | undefined) {
  return useQuery({
    queryKey: AUTONOMOUS_KEYS.mission(missionId!),
    queryFn: () => autonomousAgentClient.getMission(missionId!),
    enabled: !!missionId,
    refetchInterval: 2000,
  });
}

export function useCreateMission() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (params: {
      agentId: AutonomousAgentId;
      type: MissionType;
      objective: string;
      context?: string;
      constraints?: string[];
      successCriteria?: string[];
    }) => autonomousAgentClient.createMission(params),
    onSuccess: (mission) => {
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.missions() });
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agentMissions(mission.agentId) });
      queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agent(mission.agentId) });
    },
  });
}

// =============================================================================
// ARTIFACT HOOKS
// =============================================================================

export function useArtifacts(missionId?: MissionId) {
  return useQuery({
    queryKey: missionId ? AUTONOMOUS_KEYS.missionArtifacts(missionId) : AUTONOMOUS_KEYS.artifacts(),
    queryFn: () => autonomousAgentClient.listArtifacts(missionId),
    refetchInterval: 5000,
  });
}

export function useArtifact(artifactId: ArtifactId | undefined) {
  return useQuery({
    queryKey: AUTONOMOUS_KEYS.artifact(artifactId!),
    queryFn: () => autonomousAgentClient.getArtifact(artifactId!),
    enabled: !!artifactId,
  });
}

// =============================================================================
// VOICE HOOKS
// =============================================================================

export function useTranscribeAudio() {
  return useMutation({
    mutationFn: ({ agentId, audioPath }: { 
      agentId: AutonomousAgentId; 
      audioPath: string;
    }) => autonomousAgentClient.transcribeAudio(agentId, audioPath),
  });
}

export function useSynthesizeSpeech() {
  return useMutation({
    mutationFn: ({ agentId, text }: { 
      agentId: AutonomousAgentId; 
      text: string;
    }) => autonomousAgentClient.synthesizeSpeech(agentId, text),
  });
}

// =============================================================================
// EVENT HOOKS
// =============================================================================

export function useAgentEvents(agentId: AutonomousAgentId | undefined, limit = 100) {
  return useQuery({
    queryKey: AUTONOMOUS_KEYS.agentEvents(agentId!),
    queryFn: () => autonomousAgentClient.getRecentEvents(agentId!, limit),
    enabled: !!agentId,
    refetchInterval: 2000,
  });
}

export function useAutonomousAgentEvents(callback?: (event: AutonomousAgentEvent) => void) {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<AutonomousAgentEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<AutonomousAgentEvent | null>(null);

  useEffect(() => {
    // Subscribe to events
    autonomousAgentClient.subscribe().catch(console.error);

    const unsubscribe = autonomousAgentClient.onEvent((event) => {
      setEvents((prev) => [event, ...prev].slice(0, 1000)); // Keep last 1000 events
      setLatestEvent(event);

      // Call custom callback
      callback?.(event);

      // Invalidate relevant queries based on event type
      switch (event.type) {
        case "agent:created":
        case "agent:state_changed":
          queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agents() });
          queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agent(event.agentId) });
          break;
        case "mission:created":
        case "mission:started":
        case "mission:completed":
        case "mission:failed":
          queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.missions() });
          queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agentMissions(event.agentId) });
          if (event.missionId) {
            queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.mission(event.missionId) });
          }
          break;
        case "mission:phase_started":
        case "mission:phase_completed":
        case "action:started":
        case "action:completed":
        case "action:failed":
          if (event.missionId) {
            queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.mission(event.missionId) });
          }
          break;
        case "artifact:created":
          queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.artifacts() });
          if (event.missionId) {
            queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.missionArtifacts(event.missionId) });
          }
          break;
        case "evolution:completed":
        case "replication:completed":
          queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agents() });
          queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agent(event.agentId) });
          queryClient.invalidateQueries({ queryKey: AUTONOMOUS_KEYS.agentStats(event.agentId) });
          break;
      }
    });

    return () => {
      unsubscribe();
      autonomousAgentClient.unsubscribe().catch(console.error);
    };
  }, [callback, queryClient]);

  return { events, latestEvent };
}

// =============================================================================
// INFERENCE HANDLING HOOK
// =============================================================================

export function useAutonomousInferenceHandler(
  handler: (request: { agentId: AutonomousAgentId; model: string; prompt: string }) => Promise<string>
) {
  useEffect(() => {
    const unsubscribe = autonomousAgentClient.onInferenceRequest(async (request) => {
      try {
        const response = await handler(request);
        await autonomousAgentClient.sendInferenceResponse(request.requestId, response);
      } catch (error) {
        console.error("Error handling inference request:", error);
      }
    });

    return unsubscribe;
  }, [handler]);
}

// =============================================================================
// COMBINED MANAGER HOOK
// =============================================================================

export function useAutonomousAgentManager() {
  const agents = useAutonomousAgents();
  const createAgent = useCreateAutonomousAgent();
  const activateAgent = useActivateAgent();
  const terminateAgent = useTerminateAgent();
  const replicateAgent = useReplicateAgent();
  const createMission = useCreateMission();
  const { events, latestEvent } = useAutonomousAgentEvents();

  return {
    // Data
    agents: agents.data || [],
    isLoadingAgents: agents.isLoading,
    events,
    latestEvent,

    // Actions
    createAgent: createAgent.mutateAsync,
    isCreatingAgent: createAgent.isPending,

    activateAgent: activateAgent.mutateAsync,
    isActivatingAgent: activateAgent.isPending,

    terminateAgent: terminateAgent.mutateAsync,
    isTerminatingAgent: terminateAgent.isPending,

    replicateAgent: replicateAgent.mutateAsync,
    isReplicatingAgent: replicateAgent.isPending,

    createMission: createMission.mutateAsync,
    isCreatingMission: createMission.isPending,

    // Refetch
    refetchAgents: agents.refetch,
  };
}

/**
 * useAgentOrchestrator — TanStack Query hooks for autonomous meta-agent orchestration
 *
 * Provides:
 * - useOrchestratorDashboard()   — full dashboard with meta-agent, active tasks, system status
 * - useOrchestratorStatus()      — system subsystem status
 * - useOrchestration(id)         — single orchestration detail
 * - useOrchestrationList(filter) — list orchestrations
 * - useSubmitTask()              — mutation to submit text/voice/NLP tasks
 * - useCancelOrchestration()     — mutation to cancel
 * - usePauseOrchestration()      — mutation to pause
 * - useResumeOrchestration()     — mutation to resume
 * - useMetaAgent()               — the meta-agent info
 * - useAgentTemplates()          — available agent templates
 * - useOrchestratorConfig()      — execution / communication / long-term config
 * - useOrchestratorEvents()      — subscribe to real-time events
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback, useState, useRef } from "react";
import { agentOrchestrationClient } from "@/ipc/agent_orchestration_client";

import type {
  OrchestrationStatus,
  SubmitTaskRequest,
  SubmitTaskResponse,
  Orchestration,
  OrchestratorDashboard,
  OrchestratorEvent,
  ExecutionConfig,
  CommunicationConfig,
  LongTermTaskConfig,
} from "@/types/agent_orchestrator";

// =============================================================================
// QUERY KEYS
// =============================================================================

const KEYS = {
  dashboard: ["orchestrator", "dashboard"] as const,
  status: ["orchestrator", "status"] as const,
  metaAgent: ["orchestrator", "meta-agent"] as const,
  templates: ["orchestrator", "templates"] as const,
  orchestrations: (filter?: { status?: OrchestrationStatus; limit?: number }) =>
    ["orchestrator", "orchestrations", filter] as const,
  orchestration: (id: string) => ["orchestrator", "orchestration", id] as const,
  configExec: ["orchestrator", "config", "execution"] as const,
  configComm: ["orchestrator", "config", "communication"] as const,
  configLt: ["orchestrator", "config", "longterm"] as const,
};

// =============================================================================
// INITIALIZATION — call once on app mount
// =============================================================================

export function useOrchestratorInit() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => agentOrchestrationClient.initialize(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: KEYS.status });
    },
  });
}

// =============================================================================
// DASHBOARD
// =============================================================================

export function useOrchestratorDashboard(enabled = true) {
  return useQuery({
    queryKey: KEYS.dashboard,
    queryFn: () => agentOrchestrationClient.getDashboard(),
    enabled,
    refetchInterval: 5000,
  });
}

// =============================================================================
// SYSTEM STATUS
// =============================================================================

export function useOrchestratorStatus(enabled = true) {
  return useQuery({
    queryKey: KEYS.status,
    queryFn: () => agentOrchestrationClient.getStatus(),
    enabled,
    refetchInterval: 10000,
  });
}

// =============================================================================
// META-AGENT
// =============================================================================

export function useMetaAgent(enabled = true) {
  return useQuery({
    queryKey: KEYS.metaAgent,
    queryFn: () => agentOrchestrationClient.getMetaAgent(),
    enabled,
  });
}

// =============================================================================
// AGENT TEMPLATES
// =============================================================================

export function useAgentTemplates(enabled = true) {
  return useQuery({
    queryKey: KEYS.templates,
    queryFn: () => agentOrchestrationClient.getTemplates(),
    enabled,
  });
}

// =============================================================================
// ORCHESTRATIONS
// =============================================================================

export function useOrchestrationList(
  filter?: { status?: OrchestrationStatus; limit?: number },
  enabled = true,
) {
  return useQuery({
    queryKey: KEYS.orchestrations(filter),
    queryFn: () => agentOrchestrationClient.listOrchestrations(filter),
    enabled,
    refetchInterval: 3000,
  });
}

export function useOrchestration(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: KEYS.orchestration(id || ""),
    queryFn: () => agentOrchestrationClient.getOrchestration(id!),
    enabled: enabled && !!id,
    refetchInterval: 2000,
  });
}

// =============================================================================
// SUBMIT TASK — the main hook for users
// =============================================================================

export function useSubmitTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (request: SubmitTaskRequest) => agentOrchestrationClient.submitTask(request),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: ["orchestrator", "orchestrations"] });
    },
  });
}

/** Convenience hook: submit text directly */
export function useSubmitTextTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ text, config }: { text: string; config?: Partial<ExecutionConfig> }) =>
      agentOrchestrationClient.submitTextTask(text, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: ["orchestrator", "orchestrations"] });
    },
  });
}

/** Convenience hook: submit voice directly */
export function useSubmitVoiceTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ audioPath, config }: { audioPath: string; config?: Partial<ExecutionConfig> }) =>
      agentOrchestrationClient.submitVoiceTask(audioPath, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: ["orchestrator", "orchestrations"] });
    },
  });
}

// =============================================================================
// ORCHESTRATION CONTROLS
// =============================================================================

export function useCancelOrchestration() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => agentOrchestrationClient.cancelOrchestration(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: ["orchestrator", "orchestrations"] });
    },
  });
}

export function usePauseOrchestration() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => agentOrchestrationClient.pauseOrchestration(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: ["orchestrator", "orchestrations"] });
    },
  });
}

export function useResumeOrchestration() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => agentOrchestrationClient.resumeOrchestration(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dashboard });
      qc.invalidateQueries({ queryKey: ["orchestrator", "orchestrations"] });
    },
  });
}

// =============================================================================
// CONFIGURATION HOOKS
// =============================================================================

export function useExecutionConfig(enabled = true) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEYS.configExec,
    queryFn: () => agentOrchestrationClient.getExecutionConfig(),
    enabled,
  });

  const mutation = useMutation({
    mutationFn: (updates: Partial<ExecutionConfig>) =>
      agentOrchestrationClient.updateExecutionConfig(updates),
    onSuccess: (data) => {
      qc.setQueryData(KEYS.configExec, data);
    },
  });

  return { ...query, update: mutation.mutateAsync };
}

export function useCommunicationConfig(enabled = true) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEYS.configComm,
    queryFn: () => agentOrchestrationClient.getCommunicationConfig(),
    enabled,
  });

  const mutation = useMutation({
    mutationFn: (updates: Partial<CommunicationConfig>) =>
      agentOrchestrationClient.updateCommunicationConfig(updates),
    onSuccess: (data) => {
      qc.setQueryData(KEYS.configComm, data);
    },
  });

  return { ...query, update: mutation.mutateAsync };
}

export function useLongTermConfig(enabled = true) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEYS.configLt,
    queryFn: () => agentOrchestrationClient.getLongTermConfig(),
    enabled,
  });

  const mutation = useMutation({
    mutationFn: (updates: Partial<LongTermTaskConfig>) =>
      agentOrchestrationClient.updateLongTermConfig(updates),
    onSuccess: (data) => {
      qc.setQueryData(KEYS.configLt, data);
    },
  });

  return { ...query, update: mutation.mutateAsync };
}

// =============================================================================
// REAL-TIME EVENTS
// =============================================================================

export function useOrchestratorEvents(
  onEvent?: (event: OrchestratorEvent) => void,
) {
  const [events, setEvents] = useState<OrchestratorEvent[]>([]);
  const subscribed = useRef(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (subscribed.current) return;
    subscribed.current = true;

    agentOrchestrationClient.subscribe().catch(() => {
      // Subscription may fail if engine not initialized yet
    });

    const unsub = agentOrchestrationClient.onEvent((event: OrchestratorEvent) => {
      setEvents((prev) => [...prev.slice(-99), event]);
      onEvent?.(event);

      // Auto-invalidate relevant queries on key events
      if (
        event.type === "orchestration:completed" ||
        event.type === "orchestration:failed" ||
        event.type === "orchestration:cancelled"
      ) {
        qc.invalidateQueries({ queryKey: KEYS.dashboard });
        qc.invalidateQueries({ queryKey: ["orchestrator", "orchestrations"] });
      }

      if (event.type === "orchestration:progress" && event.orchestrationId) {
        qc.invalidateQueries({
          queryKey: KEYS.orchestration(event.orchestrationId),
        });
      }
    });

    return () => {
      unsub();
      subscribed.current = false;
    };
  }, [onEvent, qc]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, clearEvents };
}

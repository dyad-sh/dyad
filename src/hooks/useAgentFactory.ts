/**
 * Agent Factory React Hooks
 * TanStack Query hooks for custom AI agent creation and management
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import type {
  CreateCustomAgentParams,
  CustomAgentInfo,
  UpdateCustomAgentParams,
  StartAgentTrainingParams,
  AddAgentSkillParams,
  AddAgentToolParams,
  TestAgentParams,
  TestAgentResult,
} from "@/ipc/ipc_types";
import { showError, showSuccess } from "@/lib/toast";

const ipc = IpcClient.getInstance();

// =============================================================================
// Query Keys
// =============================================================================

export const agentFactoryKeys = {
  all: ["agent-factory"] as const,
  agents: () => [...agentFactoryKeys.all, "agents"] as const,
  agent: (agentId: string) => [...agentFactoryKeys.all, "agent", agentId] as const,
  skills: (agentId: string) => [...agentFactoryKeys.all, "skills", agentId] as const,
  tools: (agentId: string) => [...agentFactoryKeys.all, "tools", agentId] as const,
  templates: () => [...agentFactoryKeys.all, "templates"] as const,
  trainingStatus: (agentId: string) => [...agentFactoryKeys.all, "training-status", agentId] as const,
};

// =============================================================================
// Agent CRUD Hooks
// =============================================================================

/**
 * List all custom agents
 */
export function useCustomAgents() {
  return useQuery({
    queryKey: agentFactoryKeys.agents(),
    queryFn: async (): Promise<CustomAgentInfo[]> => {
      return ipc.listCustomAgents();
    },
  });
}

/**
 * Get a specific custom agent
 */
export function useCustomAgent(agentId: string | null) {
  return useQuery({
    queryKey: agentFactoryKeys.agent(agentId || ""),
    queryFn: async (): Promise<CustomAgentInfo | null> => {
      if (!agentId) return null;
      return ipc.getCustomAgent(agentId);
    },
    enabled: !!agentId,
  });
}

/**
 * Create a new custom agent
 */
export function useCreateCustomAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateCustomAgentParams): Promise<CustomAgentInfo> => {
      return ipc.createCustomAgent(params);
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agents() });
      showSuccess(`Agent "${agent.displayName}" created`);
    },
    onError: (error: Error) => {
      showError(`Failed to create agent: ${error.message}`);
    },
  });
}

/**
 * Update a custom agent
 */
export function useUpdateCustomAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: UpdateCustomAgentParams): Promise<CustomAgentInfo> => {
      return ipc.updateCustomAgent(params);
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agent(agent.id) });
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agents() });
      showSuccess(`Agent "${agent.displayName}" updated`);
    },
    onError: (error: Error) => {
      showError(`Failed to update agent: ${error.message}`);
    },
  });
}

/**
 * Delete a custom agent
 */
export function useDeleteCustomAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string): Promise<void> => {
      return ipc.deleteCustomAgent(agentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agents() });
      showSuccess("Agent deleted");
    },
    onError: (error: Error) => {
      showError(`Failed to delete agent: ${error.message}`);
    },
  });
}

/**
 * Duplicate a custom agent
 */
export function useDuplicateCustomAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string): Promise<CustomAgentInfo> => {
      return ipc.duplicateCustomAgent(agentId);
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agents() });
      showSuccess(`Agent duplicated as "${agent.displayName}"`);
    },
    onError: (error: Error) => {
      showError(`Failed to duplicate agent: ${error.message}`);
    },
  });
}

// =============================================================================
// Training Hooks
// =============================================================================

/**
 * Get training status for an agent
 */
export function useAgentTrainingStatus(agentId: string | null) {
  return useQuery({
    queryKey: agentFactoryKeys.trainingStatus(agentId || ""),
    queryFn: async (): Promise<{ status: string; progress: number; jobId?: string } | null> => {
      if (!agentId) return null;
      return ipc.getAgentTrainingStatus(agentId);
    },
    enabled: !!agentId,
    refetchInterval: (data) => {
      // Refetch frequently while training
      if (data?.status === "training" || data?.status === "queued") {
        return 2000;
      }
      return false;
    },
  });
}

/**
 * Start training for an agent
 */
export function useStartAgentTraining() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: StartAgentTrainingParams): Promise<{ jobId: string }> => {
      return ipc.startAgentTraining(params);
    },
    onSuccess: (result, params) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agent(params.agentId) });
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.trainingStatus(params.agentId) });
      showSuccess("Agent training started");
    },
    onError: (error: Error) => {
      showError(`Failed to start training: ${error.message}`);
    },
  });
}

/**
 * Cancel training for an agent
 */
export function useCancelAgentTraining() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string): Promise<void> => {
      return ipc.cancelAgentTraining(agentId);
    },
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agent(agentId) });
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.trainingStatus(agentId) });
      showSuccess("Training cancelled");
    },
    onError: (error: Error) => {
      showError(`Failed to cancel training: ${error.message}`);
    },
  });
}

// =============================================================================
// Skills Hooks
// =============================================================================

/**
 * List skills for an agent
 */
export function useAgentSkills(agentId: string | null) {
  return useQuery({
    queryKey: agentFactoryKeys.skills(agentId || ""),
    queryFn: async (): Promise<unknown[]> => {
      if (!agentId) return [];
      return ipc.listAgentSkills(agentId);
    },
    enabled: !!agentId,
  });
}

/**
 * Add a skill to an agent
 */
export function useAddAgentSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: AddAgentSkillParams): Promise<{ skillId: string }> => {
      return ipc.addAgentSkill(params);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.skills(params.agentId) });
      showSuccess("Skill added");
    },
    onError: (error: Error) => {
      showError(`Failed to add skill: ${error.message}`);
    },
  });
}

/**
 * Remove a skill from an agent
 */
export function useRemoveAgentSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ agentId, skillId }: { agentId: string; skillId: string }): Promise<void> => {
      return ipc.removeAgentSkill(agentId, skillId);
    },
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.skills(agentId) });
      showSuccess("Skill removed");
    },
    onError: (error: Error) => {
      showError(`Failed to remove skill: ${error.message}`);
    },
  });
}

// =============================================================================
// Tools Hooks
// =============================================================================

/**
 * List tools for an agent
 */
export function useAgentTools(agentId: string | null) {
  return useQuery({
    queryKey: agentFactoryKeys.tools(agentId || ""),
    queryFn: async (): Promise<unknown[]> => {
      if (!agentId) return [];
      return ipc.listAgentTools(agentId);
    },
    enabled: !!agentId,
  });
}

/**
 * Add a tool to an agent
 */
export function useAddAgentTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: AddAgentToolParams): Promise<{ toolId: string }> => {
      return ipc.addAgentTool(params);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.tools(params.agentId) });
      showSuccess("Tool added");
    },
    onError: (error: Error) => {
      showError(`Failed to add tool: ${error.message}`);
    },
  });
}

/**
 * Remove a tool from an agent
 */
export function useRemoveAgentTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ agentId, toolId }: { agentId: string; toolId: string }): Promise<void> => {
      return ipc.removeAgentTool(agentId, toolId);
    },
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.tools(agentId) });
      showSuccess("Tool removed");
    },
    onError: (error: Error) => {
      showError(`Failed to remove tool: ${error.message}`);
    },
  });
}

// =============================================================================
// Testing Hook
// =============================================================================

/**
 * Test an agent
 */
export function useTestAgent() {
  return useMutation({
    mutationFn: async (params: TestAgentParams): Promise<TestAgentResult> => {
      return ipc.testAgent(params);
    },
    onError: (error: Error) => {
      showError(`Failed to test agent: ${error.message}`);
    },
  });
}

// =============================================================================
// Adapter Hooks
// =============================================================================

/**
 * Set the adapter for an agent
 */
export function useSetAgentAdapter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ agentId, adapterId }: { agentId: string; adapterId: string | null }): Promise<void> => {
      return ipc.setAgentAdapter(agentId, adapterId);
    },
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agent(agentId) });
      showSuccess("Adapter updated");
    },
    onError: (error: Error) => {
      showError(`Failed to set adapter: ${error.message}`);
    },
  });
}

// =============================================================================
// Template Hooks
// =============================================================================

/**
 * List agent templates
 */
export function useAgentTemplates() {
  return useQuery({
    queryKey: agentFactoryKeys.templates(),
    queryFn: async () => {
      return ipc.listAgentTemplates();
    },
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });
}

/**
 * Create an agent from a template
 */
export function useCreateAgentFromTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      templateId,
      params,
    }: {
      templateId: string;
      params: { name: string; displayName: string; baseModelId: string };
    }): Promise<CustomAgentInfo> => {
      return ipc.createAgentFromTemplate(templateId, params);
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agents() });
      showSuccess(`Agent "${agent.displayName}" created from template`);
    },
    onError: (error: Error) => {
      showError(`Failed to create agent from template: ${error.message}`);
    },
  });
}

// =============================================================================
// Export/Import Hooks
// =============================================================================

/**
 * Export an agent
 */
export function useExportAgent() {
  return useMutation({
    mutationFn: async (agentId: string): Promise<string> => {
      return ipc.exportAgent(agentId);
    },
    onSuccess: () => {
      showSuccess("Agent exported");
    },
    onError: (error: Error) => {
      showError(`Failed to export agent: ${error.message}`);
    },
  });
}

/**
 * Import an agent
 */
export function useImportAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentJson: string): Promise<CustomAgentInfo> => {
      return ipc.importAgent(agentJson);
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: agentFactoryKeys.agents() });
      showSuccess(`Agent "${agent.displayName}" imported`);
    },
    onError: (error: Error) => {
      showError(`Failed to import agent: ${error.message}`);
    },
  });
}

// =============================================================================
// Combined Hook for Agent Details
// =============================================================================

/**
 * Get full agent details including skills and tools
 */
export function useAgentDetails(agentId: string | null) {
  const agentQuery = useCustomAgent(agentId);
  const skillsQuery = useAgentSkills(agentId);
  const toolsQuery = useAgentTools(agentId);
  const trainingQuery = useAgentTrainingStatus(agentId);

  return {
    agent: agentQuery.data,
    skills: skillsQuery.data || [],
    tools: toolsQuery.data || [],
    trainingStatus: trainingQuery.data,
    isLoading: agentQuery.isLoading || skillsQuery.isLoading || toolsQuery.isLoading,
    error: agentQuery.error || skillsQuery.error || toolsQuery.error,
    refetch: () => {
      agentQuery.refetch();
      skillsQuery.refetch();
      toolsQuery.refetch();
      trainingQuery.refetch();
    },
  };
}

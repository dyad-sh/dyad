/**
 * A2A Protocol IPC Client
 * Typed client for renderer → main process communication.
 */

import type {
  AgentCard,
  AgentCapability,
  AgentCapabilityCategory,
  AgentPricing,
  AgentEndpoint,
  AgentRegistryEntry,
  AgentSearchQuery,
  AgentSearchResult,
  A2AMessage,
  A2ATask,
  A2ATaskStatus,
  A2ANetworkStats,
} from "@/types/a2a_types";

const invoke = window.electron.ipcRenderer.invoke;

// ── Agent Registration ───────────────────────────────────────────────────────

export function registerAgent(params: {
  name: string;
  description: string;
  ownerDid: string;
  capabilities: AgentCapability[];
  pricing: AgentPricing[];
  endpoints: AgentEndpoint[];
  version?: string;
  avatarUrl?: string;
}): Promise<AgentCard> {
  return invoke("a2a:register-agent", params);
}

export function updateAgent(agentId: string, updates: Partial<AgentCard>): Promise<AgentCard> {
  return invoke("a2a:update-agent", agentId, updates);
}

export function deregisterAgent(agentId: string): Promise<void> {
  return invoke("a2a:deregister-agent", agentId);
}

export function getAgent(agentId: string): Promise<AgentCard | null> {
  return invoke("a2a:get-agent", agentId);
}

export function getMyAgents(): Promise<AgentCard[]> {
  return invoke("a2a:get-my-agents");
}

// ── Discovery ────────────────────────────────────────────────────────────────

export function searchAgents(query: AgentSearchQuery): Promise<AgentSearchResult> {
  return invoke("a2a:search-agents", query);
}

export function findAgentsByCapability(category: AgentCapabilityCategory, maxPrice?: string): Promise<AgentRegistryEntry[]> {
  return invoke("a2a:find-by-capability", category, maxPrice);
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export function createTask(
  requesterId: string,
  executorId: string,
  capabilityId: string,
  input: Record<string, unknown>,
  options?: { maxBudget?: string; currency?: string; deadlineMs?: number },
): Promise<A2ATask> {
  return invoke("a2a:create-task", requesterId, executorId, capabilityId, input, options);
}

export function acceptTask(taskId: string, agreedPrice?: string): Promise<A2ATask> {
  return invoke("a2a:accept-task", taskId, agreedPrice);
}

export function rejectTask(taskId: string, reason?: string): Promise<A2ATask> {
  return invoke("a2a:reject-task", taskId, reason);
}

export function updateTaskProgress(taskId: string, progress: number, partialOutput?: Record<string, unknown>): Promise<A2ATask> {
  return invoke("a2a:update-task-progress", taskId, progress, partialOutput);
}

export function completeTask(
  taskId: string,
  output: Record<string, unknown>,
  usage?: { inputTokens: number; outputTokens: number; computeMs: number },
): Promise<A2ATask> {
  return invoke("a2a:complete-task", taskId, output, usage);
}

export function failTask(taskId: string, reason: string): Promise<A2ATask> {
  return invoke("a2a:fail-task", taskId, reason);
}

export function getTasks(filters?: { requesterId?: string; executorId?: string; status?: A2ATaskStatus }): Promise<A2ATask[]> {
  return invoke("a2a:get-tasks", filters);
}

export function getTask(taskId: string): Promise<A2ATask | null> {
  return invoke("a2a:get-task", taskId);
}

// ── Messaging ────────────────────────────────────────────────────────────────

export function getMessages(agentId: string, limit?: number): Promise<A2AMessage[]> {
  return invoke("a2a:get-messages", agentId, limit);
}

export function getThreadMessages(threadId: string): Promise<A2AMessage[]> {
  return invoke("a2a:get-thread-messages", threadId);
}

// ── Network Stats ────────────────────────────────────────────────────────────

export function getA2ANetworkStats(): Promise<A2ANetworkStats> {
  return invoke("a2a:get-network-stats");
}

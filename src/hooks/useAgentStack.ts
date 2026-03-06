/**
 * useAgentStack Hook
 * TanStack Query hooks for agent triggers, tool catalog,
 * n8n workflow integration, and agent stack building.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { n8nWorkflowClient } from "@/ipc/n8n_workflow_client";
import type {
  AgentTrigger,
  CreateTriggerRequest,
  UpdateTriggerRequest,
  TriggerType,
} from "@/types/agent_triggers";
import type { CatalogTool, ToolCategory } from "@/types/agent_tool_catalog";
import type { N8nWorkflow } from "@/types/n8n_types";
import type {
  BuildAgentStackRequest,
  BuildAgentStackResult,
  AgentStackConfig,
} from "@/ipc/n8n_workflow_client";

// ============================================================================
// n8n Status
// ============================================================================

export function useN8nStatus() {
  return useQuery({
    queryKey: ["n8n-status"],
    queryFn: () => n8nWorkflowClient.getN8nStatus(),
    refetchInterval: 10_000,
  });
}

export function useStartN8n() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => n8nWorkflowClient.startN8n(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["n8n-status"] });
    },
  });
}

export function useStopN8n() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => n8nWorkflowClient.stopN8n(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["n8n-status"] });
    },
  });
}

// ============================================================================
// n8n Workflows
// ============================================================================

export function useN8nWorkflows() {
  return useQuery({
    queryKey: ["n8n-workflows"],
    queryFn: async () => {
      const result = await n8nWorkflowClient.listWorkflows();
      return result.data;
    },
  });
}

export function useCreateN8nWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflow: N8nWorkflow) => n8nWorkflowClient.createWorkflow(workflow),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });
}

export function useExecuteN8nWorkflow() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: Record<string, unknown> }) =>
      n8nWorkflowClient.executeWorkflow(id, data),
  });
}

export function useGenerateN8nWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: { prompt: string }) =>
      n8nWorkflowClient.generateWorkflow({ prompt: request.prompt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });
}

// ============================================================================
// Agent Triggers
// ============================================================================

export function useAgentTriggers(agentId: number) {
  return useQuery({
    queryKey: ["agent-triggers", agentId],
    queryFn: () => n8nWorkflowClient.listTriggers(agentId),
    enabled: !!agentId,
  });
}

export function useCreateTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateTriggerRequest) => n8nWorkflowClient.createTrigger(request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agent-triggers", variables.agentId] });
    },
  });
}

export function useUpdateTrigger(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateTriggerRequest) => n8nWorkflowClient.updateTrigger(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-triggers", agentId] });
    },
  });
}

export function useDeleteTrigger(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (triggerId: string) => n8nWorkflowClient.deleteTrigger(triggerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-triggers", agentId] });
    },
  });
}

export function useActivateTrigger(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (triggerId: string) => n8nWorkflowClient.activateTrigger(triggerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-triggers", agentId] });
    },
  });
}

export function usePauseTrigger(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (triggerId: string) => n8nWorkflowClient.pauseTrigger(triggerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-triggers", agentId] });
    },
  });
}

// ============================================================================
// Tool Catalog
// ============================================================================

export function useToolCatalog() {
  return useQuery({
    queryKey: ["tool-catalog"],
    queryFn: async (): Promise<CatalogTool[]> => {
      // Catalog is statically available; we can import directly for offline
      const { AGENT_TOOL_CATALOG } = await import("@/types/agent_tool_catalog");
      return AGENT_TOOL_CATALOG;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useToolCatalogByCategory(category: ToolCategory) {
  const { data: catalog = [] } = useToolCatalog();
  return catalog.filter((t) => t.category === category);
}

export function useToolCatalogSearch(query: string) {
  const { data: catalog = [] } = useToolCatalog();
  if (!query) return catalog;
  const q = query.toLowerCase();
  return catalog.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q))
  );
}

export function useAddToolFromCatalog(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (catalogToolId: string) =>
      (window as any).electron.ipcRenderer.invoke("agent:tool-catalog:add", agentId, catalogToolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tools", String(agentId)] });
    },
  });
}

// ============================================================================
// Agent Stack Builder
// ============================================================================

export function useAgentStack(agentId: number) {
  return useQuery({
    queryKey: ["agent-stack", agentId],
    queryFn: () => n8nWorkflowClient.getAgentStack(agentId),
    enabled: !!agentId,
  });
}

export function useBuildAgentStack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: BuildAgentStackRequest) => n8nWorkflowClient.buildAgentStack(request),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agent-stack", variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-triggers", variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-tools", String(variables.agentId)] });
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });
}

export function useSyncStackToN8n(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => n8nWorkflowClient.syncStackToN8n(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-stack", agentId] });
      queryClient.invalidateQueries({ queryKey: ["n8n-workflows"] });
    },
  });
}

// ============================================================================
// Trigger Templates (static data)
// ============================================================================

export interface TriggerTemplate {
  type: TriggerType;
  name: string;
  description: string;
  icon: string;
  category: string;
  n8nNodeType: string;
}

export const TRIGGER_TEMPLATES: TriggerTemplate[] = [
  {
    type: "gmail",
    name: "Gmail",
    description: "Trigger when a new email arrives in Gmail",
    icon: "📧",
    category: "email",
    n8nNodeType: "n8n-nodes-base.gmailTrigger",
  },
  {
    type: "slack",
    name: "Slack",
    description: "Trigger on Slack messages, mentions, or reactions",
    icon: "💬",
    category: "messaging",
    n8nNodeType: "n8n-nodes-base.slackTrigger",
  },
  {
    type: "google-sheets",
    name: "Google Sheets",
    description: "Trigger when rows are added or cells change in Google Sheets",
    icon: "📊",
    category: "productivity",
    n8nNodeType: "n8n-nodes-base.googleSheetsTrigger",
  },
  {
    type: "webhook",
    name: "Webhook",
    description: "Trigger via HTTP webhook endpoint",
    icon: "🔗",
    category: "webhook",
    n8nNodeType: "n8n-nodes-base.webhook",
  },
  {
    type: "schedule",
    name: "Schedule",
    description: "Trigger on a recurring schedule (cron)",
    icon: "⏰",
    category: "schedule",
    n8nNodeType: "n8n-nodes-base.scheduleTrigger",
  },
  {
    type: "calendar",
    name: "Google Calendar",
    description: "Trigger on calendar events",
    icon: "📅",
    category: "productivity",
    n8nNodeType: "n8n-nodes-base.googleCalendarTrigger",
  },
  {
    type: "discord",
    name: "Discord",
    description: "Trigger on Discord messages and events",
    icon: "🎮",
    category: "messaging",
    n8nNodeType: "n8n-nodes-base.discordTrigger",
  },
  {
    type: "telegram",
    name: "Telegram",
    description: "Trigger on Telegram messages and commands",
    icon: "✈️",
    category: "messaging",
    n8nNodeType: "n8n-nodes-base.telegramTrigger",
  },
  {
    type: "manual",
    name: "Manual",
    description: "Trigger manually via the UI",
    icon: "👆",
    category: "custom",
    n8nNodeType: "n8n-nodes-base.manualTrigger",
  },
];

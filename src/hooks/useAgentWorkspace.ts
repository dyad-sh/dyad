/**
 * Agent Workspace Hooks
 * TanStack Query hooks for agent task management, knowledge source operations,
 * task execution, and workspace queries.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentWorkspaceClient } from "@/ipc/agent_workspace_client";
import type {
  CreateAgentTaskRequest,
  UpdateAgentTaskRequest,
  ExecuteTaskRequest,
  AddKnowledgeSourceRequest,
  UpdateKnowledgeSourceRequest,
  QueryKnowledgeRequest,
  AgentTaskType,
  ExecutionMode,
  TaskPriority,
  KnowledgeSourceType,
} from "@/types/agent_workspace";
import { showError, showSuccess } from "@/lib/toast";

// =============================================================================
// TASK HOOKS
// =============================================================================

export function useAgentTasks(agentId: number) {
  return useQuery({
    queryKey: ["agent-workspace-tasks", agentId],
    queryFn: () => agentWorkspaceClient.listTasks(agentId),
    enabled: !!agentId,
    refetchInterval: 5000,
  });
}

export function useAgentTask(taskId: string) {
  return useQuery({
    queryKey: ["agent-workspace-task", taskId],
    queryFn: () => agentWorkspaceClient.getTask(taskId),
    enabled: !!taskId,
  });
}

export function useCreateTask(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateAgentTaskRequest) => agentWorkspaceClient.createTask(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-workspace-tasks", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-workspace", agentId] });
      showSuccess("Task created");
    },
    onError: (err: Error) => showError(`Failed to create task: ${err.message}`),
  });
}

export function useUpdateTask(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateAgentTaskRequest) => agentWorkspaceClient.updateTask(request),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["agent-workspace-tasks", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-workspace-task", vars.id] });
    },
    onError: (err: Error) => showError(`Failed to update task: ${err.message}`),
  });
}

export function useDeleteTask(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => agentWorkspaceClient.deleteTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-workspace-tasks", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-workspace", agentId] });
      showSuccess("Task deleted");
    },
    onError: (err: Error) => showError(`Failed to delete task: ${err.message}`),
  });
}

// =============================================================================
// TASK EXECUTION HOOKS
// =============================================================================

export function useExecuteTask(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ExecuteTaskRequest) => agentWorkspaceClient.executeTask(request),
    onSuccess: (execution) => {
      queryClient.invalidateQueries({ queryKey: ["agent-workspace-tasks", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-workspace-task", execution.taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-executions", execution.taskId] });
      queryClient.invalidateQueries({ queryKey: ["agent-workspace", agentId] });
      if (execution.status === "completed") {
        showSuccess("Task executed successfully");
      } else {
        showError(`Task failed: ${execution.error || "Unknown error"}`);
      }
    },
    onError: (err: Error) => showError(`Execution failed: ${err.message}`),
  });
}

export function useTaskExecutions(taskId: string) {
  return useQuery({
    queryKey: ["task-executions", taskId],
    queryFn: () => agentWorkspaceClient.listExecutions(taskId),
    enabled: !!taskId,
  });
}

// =============================================================================
// KNOWLEDGE SOURCE HOOKS
// =============================================================================

export function useKnowledgeSources(agentId: number) {
  return useQuery({
    queryKey: ["agent-knowledge-sources", agentId],
    queryFn: () => agentWorkspaceClient.listKnowledgeSources(agentId),
    enabled: !!agentId,
  });
}

export function useAddKnowledgeSource(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AddKnowledgeSourceRequest) =>
      agentWorkspaceClient.addKnowledgeSource(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-knowledge-sources", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-workspace", agentId] });
      showSuccess("Knowledge source added");
    },
    onError: (err: Error) => showError(`Failed to add knowledge source: ${err.message}`),
  });
}

export function useUpdateKnowledgeSource(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateKnowledgeSourceRequest) =>
      agentWorkspaceClient.updateKnowledgeSource(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-knowledge-sources", agentId] });
    },
    onError: (err: Error) => showError(`Failed to update knowledge source: ${err.message}`),
  });
}

export function useDeleteKnowledgeSource(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => agentWorkspaceClient.deleteKnowledgeSource(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-knowledge-sources", agentId] });
      queryClient.invalidateQueries({ queryKey: ["agent-workspace", agentId] });
      showSuccess("Knowledge source removed");
    },
    onError: (err: Error) => showError(`Failed to delete knowledge source: ${err.message}`),
  });
}

export function useSyncKnowledgeSource(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) => agentWorkspaceClient.syncKnowledgeSource(sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-knowledge-sources", agentId] });
      showSuccess("Knowledge source synced");
    },
    onError: (err: Error) => showError(`Sync failed: ${err.message}`),
  });
}

export function useQueryKnowledge(agentId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: QueryKnowledgeRequest) => agentWorkspaceClient.queryKnowledge(request),
    onError: (err: Error) => showError(`Knowledge query failed: ${err.message}`),
  });
}

// =============================================================================
// WORKSPACE HOOKS
// =============================================================================

export function useAgentWorkspace(agentId: number) {
  return useQuery({
    queryKey: ["agent-workspace", agentId],
    queryFn: () => agentWorkspaceClient.getWorkspace(agentId),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

// =============================================================================
// KNOWLEDGE SOURCE TYPE TEMPLATES
// =============================================================================

export const KNOWLEDGE_SOURCE_TEMPLATES: Array<{
  type: KnowledgeSourceType;
  name: string;
  description: string;
  icon: string;
  category: "local" | "web" | "ai" | "integration";
}> = [
  {
    type: "scraping_engine",
    name: "Web Scraper",
    description: "Scrape websites and extract structured data into knowledge",
    icon: "🕷️",
    category: "web",
  },
  {
    type: "ai_query",
    name: "AI Query / CAG",
    description: "Generate knowledge with AI queries using Cache Augmented Generation",
    icon: "🧠",
    category: "ai",
  },
  {
    type: "local_vault",
    name: "Local Vault",
    description: "Connect to Local Vault connectors for ingested data",
    icon: "🔒",
    category: "local",
  },
  {
    type: "local_file",
    name: "Local Files",
    description: "Watch and ingest local files and folders",
    icon: "📂",
    category: "local",
  },
  {
    type: "api_endpoint",
    name: "API Endpoint",
    description: "Fetch knowledge from REST API endpoints",
    icon: "🌍",
    category: "integration",
  },
  {
    type: "web_search",
    name: "Web Search",
    description: "Auto-search Google or Perplexity for fresh knowledge",
    icon: "🔍",
    category: "web",
  },
  {
    type: "document_upload",
    name: "Document Upload",
    description: "Upload PDFs, Word docs, spreadsheets for RAG processing",
    icon: "📄",
    category: "local",
  },
  {
    type: "rss_feed",
    name: "RSS Feed",
    description: "Subscribe to RSS/Atom feeds for real-time knowledge updates",
    icon: "📡",
    category: "web",
  },
  {
    type: "manual",
    name: "Manual Entry",
    description: "Manually add facts, instructions, and context",
    icon: "✍️",
    category: "local",
  },
];

// =============================================================================
// TASK TYPE TEMPLATES
// =============================================================================

export const TASK_TYPE_TEMPLATES: Array<{
  type: AgentTaskType;
  name: string;
  description: string;
  icon: string;
  defaultMode: ExecutionMode;
  defaultPriority: TaskPriority;
}> = [
  {
    type: "web_scrape",
    name: "Web Scrape",
    description: "Scrape a website and extract data",
    icon: "🕷️",
    defaultMode: "local",
    defaultPriority: "medium",
  },
  {
    type: "knowledge_query",
    name: "Knowledge Query",
    description: "Query knowledge sources for information",
    icon: "🔍",
    defaultMode: "local",
    defaultPriority: "medium",
  },
  {
    type: "document_process",
    name: "Document Processing",
    description: "Parse, extract, or transform documents",
    icon: "📄",
    defaultMode: "local",
    defaultPriority: "medium",
  },
  {
    type: "api_call",
    name: "API Call",
    description: "Make HTTP requests to external APIs",
    icon: "🌐",
    defaultMode: "cloud",
    defaultPriority: "medium",
  },
  {
    type: "code_execution",
    name: "Code Execution",
    description: "Execute JavaScript or Python code",
    icon: "💻",
    defaultMode: "local",
    defaultPriority: "medium",
  },
  {
    type: "llm_inference",
    name: "LLM Inference",
    description: "Run a prompt through an AI language model",
    icon: "🤖",
    defaultMode: "hybrid",
    defaultPriority: "medium",
  },
  {
    type: "data_analysis",
    name: "Data Analysis",
    description: "Analyze datasets and generate insights",
    icon: "📊",
    defaultMode: "local",
    defaultPriority: "medium",
  },
  {
    type: "search",
    name: "Web Search",
    description: "Search the web for information",
    icon: "🔎",
    defaultMode: "cloud",
    defaultPriority: "medium",
  },
  {
    type: "summarize",
    name: "Summarize",
    description: "Summarize long text or documents",
    icon: "📝",
    defaultMode: "local",
    defaultPriority: "low",
  },
  {
    type: "email",
    name: "Send Email",
    description: "Send an email message",
    icon: "📧",
    defaultMode: "cloud",
    defaultPriority: "high",
  },
  {
    type: "form_fill",
    name: "Fill Forms",
    description: "Fill in forms and tables in documents",
    icon: "📋",
    defaultMode: "local",
    defaultPriority: "medium",
  },
  {
    type: "custom",
    name: "Custom Task",
    description: "Define a custom task with free-form input",
    icon: "🔧",
    defaultMode: "hybrid",
    defaultPriority: "medium",
  },
];

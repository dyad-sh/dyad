/**
 * Orchestrator System React Hooks
 * TanStack Query hooks for workflows, agents, tasks, and n8n integration
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { 
  OrchestratorClient, 
  Workflow, 
  WorkflowExecution,
  AgentDefinition, 
  AgentType,
  AgentTeam,
  Task, 
  TaskStatus, 
  TaskType, 
  TaskPriority,
  TaskQueue,
  TaskBatch,
  N8nConnection,
  N8nWorkflow,
  WebhookEndpoint,
  N8nMapping,
} from "../ipc/orchestrator_client";

const client = OrchestratorClient.getInstance();

// ============================================================================
// Query Keys
// ============================================================================

export const orchestratorKeys = {
  all: ["orchestrator"] as const,
  
  // Workflows
  workflows: () => [...orchestratorKeys.all, "workflows"] as const,
  workflowList: (filters?: any) => [...orchestratorKeys.workflows(), "list", filters] as const,
  workflowDetail: (id: string) => [...orchestratorKeys.workflows(), "detail", id] as const,
  
  // Executions
  executions: () => [...orchestratorKeys.all, "executions"] as const,
  executionList: (workflowId?: string) => [...orchestratorKeys.executions(), "list", workflowId] as const,
  executionDetail: (id: string) => [...orchestratorKeys.executions(), "detail", id] as const,
  
  // Agents
  agents: () => [...orchestratorKeys.all, "agents"] as const,
  agentList: (filters?: any) => [...orchestratorKeys.agents(), "list", filters] as const,
  agentDetail: (id: string) => [...orchestratorKeys.agents(), "detail", id] as const,
  agentTemplates: () => [...orchestratorKeys.agents(), "templates"] as const,
  
  // Teams
  teams: () => [...orchestratorKeys.all, "teams"] as const,
  teamList: () => [...orchestratorKeys.teams(), "list"] as const,
  teamDetail: (id: string) => [...orchestratorKeys.teams(), "detail", id] as const,
  
  // Tasks
  tasks: () => [...orchestratorKeys.all, "tasks"] as const,
  taskList: (filters?: any) => [...orchestratorKeys.tasks(), "list", filters] as const,
  taskDetail: (id: string) => [...orchestratorKeys.tasks(), "detail", id] as const,
  taskTemplates: (category?: string) => [...orchestratorKeys.tasks(), "templates", category] as const,
  taskMetrics: () => [...orchestratorKeys.tasks(), "metrics"] as const,
  
  // Queues
  queues: () => [...orchestratorKeys.all, "queues"] as const,
  queueList: () => [...orchestratorKeys.queues(), "list"] as const,
  queueDetail: (id: string) => [...orchestratorKeys.queues(), "detail", id] as const,
  
  // Batches
  batches: () => [...orchestratorKeys.all, "batches"] as const,
  batchList: () => [...orchestratorKeys.batches(), "list"] as const,
  batchDetail: (id: string) => [...orchestratorKeys.batches(), "detail", id] as const,
  
  // N8n
  n8n: () => [...orchestratorKeys.all, "n8n"] as const,
  n8nConfig: () => [...orchestratorKeys.n8n(), "config"] as const,
  n8nConnections: () => [...orchestratorKeys.n8n(), "connections"] as const,
  n8nWorkflows: (connectionId: string) => [...orchestratorKeys.n8n(), "workflows", connectionId] as const,
  n8nWebhooks: () => [...orchestratorKeys.n8n(), "webhooks"] as const,
  n8nMappings: () => [...orchestratorKeys.n8n(), "mappings"] as const,
  n8nTemplates: (category?: string) => [...orchestratorKeys.n8n(), "templates", category] as const,
  n8nServerStatus: () => [...orchestratorKeys.n8n(), "server-status"] as const,
  
  // Metrics
  orchestratorMetrics: () => [...orchestratorKeys.all, "metrics"] as const,
};

// ============================================================================
// Workflow Hooks
// ============================================================================

export function useWorkflows(filters?: { status?: string; tags?: string[]; limit?: number }) {
  return useQuery({
    queryKey: orchestratorKeys.workflowList(filters),
    queryFn: () => client.listWorkflows(filters),
  });
}

export function useWorkflow(workflowId: string) {
  return useQuery({
    queryKey: orchestratorKeys.workflowDetail(workflowId),
    queryFn: () => client.getWorkflow(workflowId),
    enabled: !!workflowId,
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createWorkflow>[0]) => 
      client.createWorkflow(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.workflows() });
    },
  });
}

export function useUpdateWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ workflowId, updates }: { workflowId: string; updates: Partial<Workflow> }) => 
      client.updateWorkflow(workflowId, updates),
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.workflowDetail(workflowId) });
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.workflowList() });
    },
  });
}

export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (workflowId: string) => client.deleteWorkflow(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.workflows() });
    },
  });
}

export function useExecuteWorkflow() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ workflowId, variables }: { workflowId: string; variables?: Record<string, any> }) => 
      client.executeWorkflow(workflowId, variables),
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.executionList(workflowId) });
    },
  });
}

export function useExecutions(workflowId?: string) {
  return useQuery({
    queryKey: orchestratorKeys.executionList(workflowId),
    queryFn: () => client.listExecutions(workflowId),
  });
}

export function useExecution(executionId: string) {
  return useQuery({
    queryKey: orchestratorKeys.executionDetail(executionId),
    queryFn: () => client.getExecution(executionId),
    enabled: !!executionId,
    refetchInterval: (query) => {
      const execution = query.state?.data as WorkflowExecution | undefined;
      return execution?.status === "running" ? 1000 : false;
    },
  });
}

export function useCancelExecution() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (executionId: string) => client.cancelExecution(executionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.executions() });
    },
  });
}

export function useScheduleWorkflow() {
  return useMutation({
    mutationFn: ({ workflowId, schedule }: { workflowId: string; schedule: { cron?: string; runAt?: Date } }) => 
      client.scheduleWorkflow(workflowId, schedule),
  });
}

export function useEmitEvent() {
  return useMutation({
    mutationFn: ({ eventName, data }: { eventName: string; data: any }) => 
      client.emitEvent(eventName, data),
  });
}

export function useOrchestratorMetrics() {
  return useQuery({
    queryKey: orchestratorKeys.orchestratorMetrics(),
    queryFn: () => client.getOrchestratorMetrics(),
    refetchInterval: 5000,
  });
}

// ============================================================================
// Agent Hooks
// ============================================================================

export function useAgents(filters?: { type?: AgentType; status?: string; tags?: string[] }) {
  return useQuery({
    queryKey: orchestratorKeys.agentList(filters),
    queryFn: () => client.listAgents(filters),
  });
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: orchestratorKeys.agentDetail(agentId),
    queryFn: () => client.getAgent(agentId),
    enabled: !!agentId,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createAgent>[0]) => 
      client.createAgent(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.agents() });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ agentId, updates }: { agentId: string; updates: Partial<AgentDefinition> }) => 
      client.updateAgent(agentId, updates),
    onSuccess: (_, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.agentDetail(agentId) });
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.agentList() });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (agentId: string) => client.deleteAgent(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.agents() });
    },
  });
}

export function useExecuteAgent() {
  return useMutation({
    mutationFn: ({ agentId, input, sessionId }: { agentId: string; input: any; sessionId?: string }) => 
      client.executeAgent(agentId, input, sessionId),
  });
}

export function useCreateAgentSession() {
  return useMutation({
    mutationFn: (agentId: string) => client.createAgentSession(agentId),
  });
}

export function useEndAgentSession() {
  return useMutation({
    mutationFn: (sessionId: string) => client.endAgentSession(sessionId),
  });
}

export function useAgentTemplates() {
  return useQuery({
    queryKey: orchestratorKeys.agentTemplates(),
    queryFn: () => client.listAgentTemplates(),
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createTeam>[0]) => 
      client.createTeam(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.teams() });
    },
  });
}

export function useExecuteTeam() {
  return useMutation({
    mutationFn: ({ teamId, input }: { teamId: string; input: any }) => 
      client.executeTeam(teamId, input),
  });
}

// ============================================================================
// Task Hooks
// ============================================================================

export function useTasks(filters?: {
  status?: TaskStatus | TaskStatus[];
  type?: TaskType;
  priority?: TaskPriority;
  tags?: string[];
  limit?: number;
}) {
  return useQuery({
    queryKey: orchestratorKeys.taskList(filters),
    queryFn: () => client.listTasks(filters),
    refetchInterval: 2000,
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: orchestratorKeys.taskDetail(taskId),
    queryFn: () => client.getTask(taskId),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const task = query.state?.data as Task | undefined;
      return task?.status === "running" || task?.status === "queued" ? 1000 : false;
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createTask>[0]) => 
      client.createTask(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.tasks() });
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.queues() });
    },
  });
}

export function useCreateTaskFromTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createTaskFromTemplate>[0]) => 
      client.createTaskFromTemplate(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.tasks() });
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.queues() });
    },
  });
}

export function useCancelTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (taskId: string) => client.cancelTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.tasks() });
    },
  });
}

export function useRetryTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (taskId: string) => client.retryTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.tasks() });
    },
  });
}

export function useTaskTemplates(category?: string) {
  return useQuery({
    queryKey: orchestratorKeys.taskTemplates(category),
    queryFn: () => client.listTaskTemplates(category),
  });
}

export function useTaskMetrics() {
  return useQuery({
    queryKey: orchestratorKeys.taskMetrics(),
    queryFn: () => client.getTaskMetrics(),
    refetchInterval: 5000,
  });
}

// ============================================================================
// Queue Hooks
// ============================================================================

export function useQueues() {
  return useQuery({
    queryKey: orchestratorKeys.queueList(),
    queryFn: () => client.listQueues(),
    refetchInterval: 2000,
  });
}

export function useCreateQueue() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: { name: string; maxConcurrency?: number }) => 
      client.createQueue(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.queues() });
    },
  });
}

export function usePauseQueue() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (queueId: string) => client.pauseQueue(queueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.queues() });
    },
  });
}

export function useResumeQueue() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (queueId: string) => client.resumeQueue(queueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.queues() });
    },
  });
}

// ============================================================================
// Batch Hooks
// ============================================================================

export function useCreateBatch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createBatch>[0]) => 
      client.createBatch(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.batches() });
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.tasks() });
    },
  });
}

export function useBatch(batchId: string) {
  return useQuery({
    queryKey: orchestratorKeys.batchDetail(batchId),
    queryFn: () => client.getBatch(batchId),
    enabled: !!batchId,
    refetchInterval: (query) => {
      const batch = query.state?.data as TaskBatch | undefined;
      return batch?.status === "running" ? 1000 : false;
    },
  });
}

// ============================================================================
// N8n Hooks
// ============================================================================

export function useN8nConfig() {
  return useQuery({
    queryKey: orchestratorKeys.n8nConfig(),
    queryFn: () => client.getN8nConfig(),
  });
}

export function useUpdateN8nConfig() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (updates: Record<string, any>) => client.updateN8nConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nConfig() });
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nServerStatus() });
    },
  });
}

export function useN8nConnections() {
  return useQuery({
    queryKey: orchestratorKeys.n8nConnections(),
    queryFn: () => client.listN8nConnections(),
  });
}

export function useAddN8nConnection() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: { name: string; baseUrl: string; apiKey?: string }) => 
      client.addN8nConnection(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nConnections() });
    },
  });
}

export function useTestN8nConnection() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (connectionId: string) => client.testN8nConnection(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nConnections() });
    },
  });
}

export function useN8nWorkflows(connectionId: string) {
  return useQuery({
    queryKey: orchestratorKeys.n8nWorkflows(connectionId),
    queryFn: () => client.listN8nWorkflows(connectionId),
    enabled: !!connectionId,
  });
}

export function useExecuteN8nWorkflow() {
  return useMutation({
    mutationFn: ({ connectionId, workflowId, data }: { 
      connectionId: string; 
      workflowId: string; 
      data?: any 
    }) => client.executeN8nWorkflow(connectionId, workflowId, data),
  });
}

export function useWebhooks() {
  return useQuery({
    queryKey: orchestratorKeys.n8nWebhooks(),
    queryFn: () => client.listWebhooks(),
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: { 
      path: string; 
      method?: string; 
      handler: { type: string; target: string } 
    }) => client.createWebhook(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nWebhooks() });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (webhookId: string) => client.deleteWebhook(webhookId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nWebhooks() });
    },
  });
}

export function useN8nMappings() {
  return useQuery({
    queryKey: orchestratorKeys.n8nMappings(),
    queryFn: () => client.listN8nMappings(),
  });
}

export function useCreateN8nMapping() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createN8nMapping>[0]) => 
      client.createN8nMapping(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nMappings() });
    },
  });
}

export function useSyncN8nMapping() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (mappingId: string) => client.syncN8nMapping(mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nMappings() });
    },
  });
}

export function useN8nTemplates(category?: string) {
  return useQuery({
    queryKey: orchestratorKeys.n8nTemplates(category),
    queryFn: () => client.listN8nTemplates(category),
  });
}

export function useDeployN8nTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.deployN8nTemplate>[0]) => 
      client.deployN8nTemplate(args),
    onSuccess: (_, { connectionId }) => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nWorkflows(connectionId) });
    },
  });
}

export function useN8nServerStatus() {
  return useQuery({
    queryKey: orchestratorKeys.n8nServerStatus(),
    queryFn: () => client.getN8nServerStatus(),
    refetchInterval: 5000,
  });
}

export function useStartN8nServer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => client.startN8nServer(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nServerStatus() });
    },
  });
}

export function useStopN8nServer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => client.stopN8nServer(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorKeys.n8nServerStatus() });
    },
  });
}

// ============================================================================
// Composite Hooks
// ============================================================================

/**
 * Hook for managing the complete orchestrator dashboard
 */
export function useOrchestratorDashboard() {
  const workflowsQuery = useWorkflows({ limit: 10 });
  const agentsQuery = useAgents();
  const tasksQuery = useTasks({ status: ["running", "queued"], limit: 20 });
  const queuesQuery = useQueues();
  const metricsQuery = useTaskMetrics();
  const n8nStatusQuery = useN8nServerStatus();

  return {
    workflows: workflowsQuery.data ?? [],
    agents: agentsQuery.data ?? [],
    tasks: tasksQuery.data ?? [],
    queues: queuesQuery.data ?? [],
    metrics: metricsQuery.data,
    n8nStatus: n8nStatusQuery.data,
    isLoading: workflowsQuery.isLoading || agentsQuery.isLoading || tasksQuery.isLoading,
    isError: workflowsQuery.isError || agentsQuery.isError || tasksQuery.isError,
    refetch: useCallback(() => {
      workflowsQuery.refetch();
      agentsQuery.refetch();
      tasksQuery.refetch();
      queuesQuery.refetch();
      metricsQuery.refetch();
    }, [workflowsQuery, agentsQuery, tasksQuery, queuesQuery, metricsQuery]),
  };
}

/**
 * Hook for quick task creation and execution
 */
export function useQuickTask() {
  const createTask = useCreateTask();
  const createFromTemplate = useCreateTaskFromTemplate();
  const queryClient = useQueryClient();

  const runTask = useCallback(async (args: {
    name: string;
    type: TaskType;
    handler: string;
    parameters: Record<string, any>;
    input?: any;
    priority?: TaskPriority;
  }) => {
    const result = await createTask.mutateAsync({
      name: args.name,
      type: args.type,
      priority: args.priority || "normal",
      config: {
        handler: args.handler,
        parameters: args.parameters,
      },
      input: args.input,
      autoStart: true,
    });
    return result;
  }, [createTask]);

  const runFromTemplate = useCallback(async (
    templateId: string,
    name: string,
    input?: any
  ) => {
    const result = await createFromTemplate.mutateAsync({
      templateId,
      name,
      input,
      autoStart: true,
    });
    return result;
  }, [createFromTemplate]);

  return {
    runTask,
    runFromTemplate,
    isLoading: createTask.isPending || createFromTemplate.isPending,
    error: createTask.error || createFromTemplate.error,
  };
}

/**
 * Hook for agent chat session
 */
export function useAgentChat(agentId: string) {
  const createSession = useCreateAgentSession();
  const executeAgent = useExecuteAgent();
  const endSession = useEndAgentSession();

  const startChat = useCallback(async () => {
    const sessionId = await createSession.mutateAsync(agentId);
    return sessionId;
  }, [agentId, createSession]);

  const sendMessage = useCallback(async (sessionId: string, message: string) => {
    const result = await executeAgent.mutateAsync({
      agentId,
      input: { message },
      sessionId,
    });
    return result;
  }, [agentId, executeAgent]);

  const endChat = useCallback(async (sessionId: string) => {
    await endSession.mutateAsync(sessionId);
  }, [endSession]);

  return {
    startChat,
    sendMessage,
    endChat,
    isStarting: createSession.isPending,
    isSending: executeAgent.isPending,
    error: executeAgent.error,
  };
}

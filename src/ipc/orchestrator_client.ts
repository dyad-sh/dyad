/**
 * Orchestrator & Agent System IPC Client
 * Client-side wrapper for orchestration, agent management, tasks, and n8n integration
 */

// ============================================================================
// Types - Orchestrator
// ============================================================================

export type NodeType = 
  | "start" | "end" | "task" | "agent" | "decision" | "fork" | "join"
  | "loop" | "map" | "reduce" | "delay" | "event" | "subworkflow"
  | "http" | "script" | "data_operation" | "notification" | "approval"
  | "n8n_trigger" | "n8n_action";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, any>;
  position: { x: number; y: number };
  inputs: string[];
  outputs: string[];
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  condition?: string;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, any>;
  triggers: WorkflowTrigger[];
  settings: WorkflowSettings;
  version: number;
  status: "draft" | "active" | "paused" | "archived";
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
}

export interface WorkflowTrigger {
  id: string;
  type: "manual" | "schedule" | "webhook" | "event" | "n8n";
  config: Record<string, any>;
  enabled: boolean;
}

export interface WorkflowSettings {
  maxConcurrency: number;
  timeout?: number;
  retryPolicy: {
    enabled: boolean;
    maxAttempts: number;
    delayMs: number;
  };
  errorHandling: "stop" | "continue" | "retry";
  logging: "minimal" | "normal" | "verbose";
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  completedAt?: Date;
  variables: Record<string, any>;
  nodeStates: Map<string, any>;
  currentNodes: string[];
  error?: string;
}

// ============================================================================
// Types - Agent Builder
// ============================================================================

export type AgentType = 
  | "assistant" | "worker" | "coordinator" | "specialist"
  | "data_processor" | "code_assistant" | "research_agent"
  | "automation_agent" | "custom";

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  type: AgentType;
  version: string;
  config: AgentConfig;
  tools: AgentTool[];
  memory: AgentMemoryConfig;
  behaviors: AgentBehavior[];
  constraints: AgentConstraints;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  status: "draft" | "active" | "deprecated";
  tags: string[];
}

export interface AgentConfig {
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  responseFormat?: "text" | "json" | "structured";
  customInstructions?: string;
}

export interface AgentTool {
  id: string;
  name: string;
  type: "builtin" | "custom" | "mcp" | "api" | "script";
  enabled: boolean;
  config: Record<string, any>;
}

export interface AgentMemoryConfig {
  shortTerm: { enabled: boolean; maxItems: number };
  longTerm: { enabled: boolean; vectorStore?: string };
  episodic: { enabled: boolean; maxEpisodes: number };
  semantic: { enabled: boolean };
  working: { enabled: boolean; maxSize: number };
}

export interface AgentBehavior {
  id: string;
  trigger: string;
  action: string;
  priority: number;
}

export interface AgentConstraints {
  maxExecutionTime?: number;
  maxToolCalls?: number;
  maxTokensPerTurn?: number;
  allowedTools?: string[];
  deniedTools?: string[];
  rateLimits?: Record<string, number>;
}

export interface AgentTeam {
  id: string;
  name: string;
  description?: string;
  agents: TeamMember[];
  coordinator?: string;
  communicationPattern: "broadcast" | "direct" | "hierarchical" | "mesh";
  decisionStrategy: "consensus" | "majority" | "coordinator" | "first";
}

export interface TeamMember {
  agentId: string;
  role: string;
  capabilities: string[];
  priority: number;
}

// ============================================================================
// Types - Task Engine
// ============================================================================

export type TaskStatus = "pending" | "queued" | "running" | "completed" | "failed" | "cancelled" | "paused" | "retrying";
export type TaskPriority = "critical" | "high" | "normal" | "low" | "background";
export type TaskType = 
  | "data_import" | "data_export" | "data_transform" | "data_validate"
  | "agent_execution" | "workflow_trigger" | "api_call" | "script"
  | "file_operation" | "notification" | "scheduled" | "webhook"
  | "batch_process" | "pipeline_step" | "custom";

export interface Task {
  id: string;
  name: string;
  description?: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  config: TaskConfig;
  input?: any;
  output?: any;
  dependencies: TaskDependency[];
  metrics: TaskMetrics;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  tags: string[];
  error?: string;
}

export interface TaskConfig {
  handler: string;
  parameters: Record<string, any>;
  timeout?: number;
}

export interface TaskDependency {
  taskId: string;
  type: "required" | "optional" | "soft";
  condition?: string;
}

export interface TaskMetrics {
  attempts: number;
  totalDuration?: number;
  waitTime?: number;
  executionTime?: number;
  retryCount: number;
}

export interface TaskQueue {
  id: string;
  name: string;
  maxConcurrency: number;
  currentConcurrency: number;
  tasks: string[];
  paused: boolean;
}

export interface TaskBatch {
  id: string;
  name: string;
  taskIds: string[];
  status: "pending" | "running" | "completed" | "failed" | "partial";
  progress: {
    total: number;
    completed: number;
    failed: number;
    running: number;
  };
}

// ============================================================================
// Types - N8n Integration
// ============================================================================

export interface N8nConnection {
  id: string;
  name: string;
  baseUrl: string;
  status: "connected" | "disconnected" | "error";
  version?: string;
  error?: string;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: any[];
  connections: Record<string, any>;
}

export interface WebhookEndpoint {
  id: string;
  path: string;
  method: string;
  enabled: boolean;
  triggerCount: number;
  webhookUrl?: string;
}

export interface N8nMapping {
  id: string;
  name: string;
  localType: string;
  localId: string;
  n8nWorkflowId: string;
  syncStatus: "synced" | "pending" | "conflict" | "error";
}

// ============================================================================
// Client Class
// ============================================================================

type IpcInvoker = { invoke: (channel: string, ...args: unknown[]) => Promise<any> };

export class OrchestratorClient {
  private static instance: OrchestratorClient;
  private ipc: IpcInvoker;

  private constructor() {
    this.ipc = (window as any).electron?.ipcRenderer ?? { invoke: async () => { throw new Error("IPC not available"); } };
  }

  static getInstance(): OrchestratorClient {
    if (!OrchestratorClient.instance) {
      OrchestratorClient.instance = new OrchestratorClient();
    }
    return OrchestratorClient.instance;
  }

  // ========== Workflow Operations ==========

  async createWorkflow(args: {
    name: string;
    description?: string;
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    triggers?: WorkflowTrigger[];
    settings?: Partial<WorkflowSettings>;
    tags?: string[];
  }): Promise<Workflow> {
    const result = await this.ipc.invoke("orchestrator:create-workflow", args);
    return result.workflow;
  }

  async getWorkflow(workflowId: string): Promise<Workflow> {
    const result = await this.ipc.invoke("orchestrator:get-workflow", workflowId);
    return result.workflow;
  }

  async listWorkflows(args?: {
    status?: string;
    tags?: string[];
    limit?: number;
  }): Promise<Workflow[]> {
    const result = await this.ipc.invoke("orchestrator:list-workflows", args);
    return result.workflows;
  }

  async updateWorkflow(workflowId: string, updates: Partial<Workflow>): Promise<Workflow> {
    const result = await this.ipc.invoke("orchestrator:update-workflow", { workflowId, updates });
    return result.workflow;
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    await this.ipc.invoke("orchestrator:delete-workflow", workflowId);
  }

  async executeWorkflow(workflowId: string, variables?: Record<string, any>): Promise<WorkflowExecution> {
    const result = await this.ipc.invoke("orchestrator:execute-workflow", { workflowId, variables });
    return result.execution;
  }

  async cancelExecution(executionId: string): Promise<void> {
    await this.ipc.invoke("orchestrator:cancel-execution", executionId);
  }

  async getExecution(executionId: string): Promise<WorkflowExecution> {
    const result = await this.ipc.invoke("orchestrator:get-execution", executionId);
    return result.execution;
  }

  async listExecutions(workflowId?: string): Promise<WorkflowExecution[]> {
    const result = await this.ipc.invoke("orchestrator:list-executions", workflowId);
    return result.executions;
  }

  async scheduleWorkflow(workflowId: string, schedule: { cron?: string; runAt?: Date }): Promise<any> {
    const result = await this.ipc.invoke("orchestrator:schedule-workflow", { workflowId, schedule });
    return result.schedule;
  }

  async emitEvent(eventName: string, data: any): Promise<void> {
    await this.ipc.invoke("orchestrator:emit-event", { eventName, data });
  }

  async getOrchestratorMetrics(): Promise<any> {
    const result = await this.ipc.invoke("orchestrator:get-metrics");
    return result.metrics;
  }

  // ========== Agent Operations ==========

  async createAgent(args: {
    name: string;
    description?: string;
    type: AgentType;
    config: Partial<AgentConfig>;
    tools?: AgentTool[];
    memory?: Partial<AgentMemoryConfig>;
    tags?: string[];
  }): Promise<AgentDefinition> {
    const result = await this.ipc.invoke("agent-builder:create-agent", args);
    return result.agent;
  }

  async getAgent(agentId: string): Promise<AgentDefinition> {
    const result = await this.ipc.invoke("agent-builder:get-agent", agentId);
    return result.agent;
  }

  async listAgents(args?: {
    type?: AgentType;
    status?: string;
    tags?: string[];
  }): Promise<AgentDefinition[]> {
    const result = await this.ipc.invoke("agent-builder:list-agents", args);
    return result.agents;
  }

  async updateAgent(agentId: string, updates: Partial<AgentDefinition>): Promise<AgentDefinition> {
    const result = await this.ipc.invoke("agent-builder:update-agent", { agentId, updates });
    return result.agent;
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.ipc.invoke("agent-builder:delete-agent", agentId);
  }

  async executeAgent(agentId: string, input: any, sessionId?: string): Promise<any> {
    const result = await this.ipc.invoke("agent-builder:execute-agent", { agentId, input, sessionId });
    return result;
  }

  async createAgentSession(agentId: string): Promise<string> {
    const result = await this.ipc.invoke("agent-builder:create-session", agentId);
    return result.sessionId;
  }

  async getAgentSession(sessionId: string): Promise<any> {
    const result = await this.ipc.invoke("agent-builder:get-session", sessionId);
    return result.session;
  }

  async endAgentSession(sessionId: string): Promise<void> {
    await this.ipc.invoke("agent-builder:end-session", sessionId);
  }

  async createTeam(args: {
    name: string;
    description?: string;
    agents: TeamMember[];
    coordinator?: string;
    communicationPattern?: string;
    decisionStrategy?: string;
  }): Promise<AgentTeam> {
    const result = await this.ipc.invoke("agent-builder:create-team", args);
    return result.team;
  }

  async executeTeam(teamId: string, input: any): Promise<any> {
    const result = await this.ipc.invoke("agent-builder:execute-team", { teamId, input });
    return result;
  }

  async listAgentTemplates(): Promise<any[]> {
    const result = await this.ipc.invoke("agent-builder:list-templates");
    return result.templates;
  }

  // ========== Task Operations ==========

  async createTask(args: {
    name: string;
    type: TaskType;
    priority?: TaskPriority;
    config: TaskConfig;
    input?: any;
    dependencies?: TaskDependency[];
    tags?: string[];
    queueId?: string;
    autoStart?: boolean;
  }): Promise<Task> {
    const result = await this.ipc.invoke("task-engine:create-task", args);
    return result.task;
  }

  async createTaskFromTemplate(args: {
    templateId: string;
    name: string;
    input?: any;
    queueId?: string;
    autoStart?: boolean;
  }): Promise<Task> {
    const result = await this.ipc.invoke("task-engine:create-from-template", args);
    return result.task;
  }

  async getTask(taskId: string): Promise<Task> {
    const result = await this.ipc.invoke("task-engine:get-task", taskId);
    return result.task;
  }

  async listTasks(args?: {
    status?: TaskStatus | TaskStatus[];
    type?: TaskType;
    priority?: TaskPriority;
    tags?: string[];
    limit?: number;
  }): Promise<Task[]> {
    const result = await this.ipc.invoke("task-engine:list-tasks", args);
    return result.tasks;
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.ipc.invoke("task-engine:cancel-task", taskId);
  }

  async retryTask(taskId: string): Promise<Task> {
    const result = await this.ipc.invoke("task-engine:retry-task", taskId);
    return result.task;
  }

  async createQueue(args: {
    name: string;
    maxConcurrency?: number;
  }): Promise<TaskQueue> {
    const result = await this.ipc.invoke("task-engine:create-queue", args);
    return result.queue;
  }

  async listQueues(): Promise<TaskQueue[]> {
    const result = await this.ipc.invoke("task-engine:list-queues");
    return result.queues;
  }

  async pauseQueue(queueId: string): Promise<void> {
    await this.ipc.invoke("task-engine:pause-queue", queueId);
  }

  async resumeQueue(queueId: string): Promise<void> {
    await this.ipc.invoke("task-engine:resume-queue", queueId);
  }

  async createBatch(args: {
    name: string;
    tasks: Array<{ name: string; type: TaskType; config: TaskConfig; input?: any }>;
    parallelism?: number;
  }): Promise<TaskBatch> {
    const result = await this.ipc.invoke("task-engine:create-batch", args);
    return result.batch;
  }

  async getBatch(batchId: string): Promise<TaskBatch> {
    const result = await this.ipc.invoke("task-engine:get-batch", batchId);
    return result.batch;
  }

  async listTaskTemplates(category?: string): Promise<any[]> {
    const result = await this.ipc.invoke("task-engine:list-templates", category);
    return result.templates;
  }

  async getTaskMetrics(): Promise<any> {
    const result = await this.ipc.invoke("task-engine:get-metrics");
    return result.metrics;
  }

  // ========== N8n Operations ==========

  async getN8nConfig(): Promise<any> {
    const result = await this.ipc.invoke("n8n:get-config");
    return result.config;
  }

  async updateN8nConfig(updates: Record<string, any>): Promise<any> {
    const result = await this.ipc.invoke("n8n:update-config", updates);
    return result.config;
  }

  async addN8nConnection(args: {
    name: string;
    baseUrl: string;
    apiKey?: string;
  }): Promise<N8nConnection> {
    const result = await this.ipc.invoke("n8n:add-connection", args);
    return result.connection;
  }

  async testN8nConnection(connectionId: string): Promise<boolean> {
    const result = await this.ipc.invoke("n8n:test-connection", connectionId);
    return result.connected;
  }

  async listN8nConnections(): Promise<N8nConnection[]> {
    const result = await this.ipc.invoke("n8n:list-connections");
    return result.connections;
  }

  async listN8nWorkflows(connectionId: string): Promise<N8nWorkflow[]> {
    const result = await this.ipc.invoke("n8n:list-workflows", connectionId);
    return result.workflows;
  }

  async executeN8nWorkflow(connectionId: string, workflowId: string, data?: any): Promise<any> {
    const result = await this.ipc.invoke("n8n:execute-workflow", { connectionId, workflowId, data });
    return result.execution;
  }

  async createWebhook(args: {
    path: string;
    method?: string;
    handler: { type: string; target: string };
  }): Promise<WebhookEndpoint> {
    const result = await this.ipc.invoke("n8n:create-webhook", args);
    return { ...result.endpoint, webhookUrl: result.webhookUrl };
  }

  async listWebhooks(): Promise<WebhookEndpoint[]> {
    const result = await this.ipc.invoke("n8n:list-webhooks");
    return result.webhooks;
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.ipc.invoke("n8n:delete-webhook", webhookId);
  }

  async createN8nMapping(args: {
    name: string;
    localType: string;
    localId: string;
    n8nWorkflowId: string;
    n8nConnectionId: string;
    syncMode?: string;
  }): Promise<N8nMapping> {
    const result = await this.ipc.invoke("n8n:create-mapping", args);
    return result.mapping;
  }

  async listN8nMappings(): Promise<N8nMapping[]> {
    const result = await this.ipc.invoke("n8n:list-mappings");
    return result.mappings;
  }

  async syncN8nMapping(mappingId: string): Promise<N8nMapping> {
    const result = await this.ipc.invoke("n8n:sync-mapping", mappingId);
    return result.mapping;
  }

  async listN8nTemplates(category?: string): Promise<any[]> {
    const result = await this.ipc.invoke("n8n:list-templates", category);
    return result.templates;
  }

  async deployN8nTemplate(args: {
    templateId: string;
    connectionId: string;
    variables: Record<string, any>;
    name?: string;
  }): Promise<N8nWorkflow> {
    const result = await this.ipc.invoke("n8n:deploy-template", args);
    return result.workflow;
  }

  async startN8nServer(): Promise<number> {
    const result = await this.ipc.invoke("n8n:start-server");
    return result.port;
  }

  async stopN8nServer(): Promise<void> {
    await this.ipc.invoke("n8n:stop-server");
  }

  async getN8nServerStatus(): Promise<{ running: boolean; port: number; endpointCount: number }> {
    const result = await this.ipc.invoke("n8n:get-server-status");
    return result;
  }
}

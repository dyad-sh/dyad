/**
 * n8n Integration Types
 * Types for n8n workflow automation integration
 */

// ============================================================================
// n8n Workflow Types
// ============================================================================

export interface N8nWorkflow {
  id?: string;
  name: string;
  active: boolean;
  nodes: N8nNode[];
  connections: N8nConnections;
  settings?: N8nWorkflowSettings;
  staticData?: Record<string, unknown>;
  tags?: N8nTag[];
  pinData?: Record<string, unknown>;
  versionId?: string;
  meta?: {
    instanceId?: string;
  };
}

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, N8nCredentialReference>;
  disabled?: boolean;
  notes?: string;
  notesInFlow?: boolean;
  webhookId?: string;
}

export interface N8nCredentialReference {
  id: string;
  name: string;
}

export interface N8nConnections {
  [nodeName: string]: {
    [outputType: string]: Array<Array<{
      node: string;
      type: string;
      index: number;
    }>>;
  };
}

export interface N8nWorkflowSettings {
  executionOrder?: "v0" | "v1";
  saveManualExecutions?: boolean;
  callerPolicy?: "any" | "none" | "workflowsFromAList" | "workflowsFromSameOwner";
  errorWorkflow?: string;
  timezone?: string;
  saveDataErrorExecution?: "all" | "none";
  saveDataSuccessExecution?: "all" | "none";
}

export interface N8nTag {
  id: string;
  name: string;
}

// ============================================================================
// n8n API Types
// ============================================================================

export interface N8nApiConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface N8nExecutionResult {
  id: string;
  finished: boolean;
  mode: string;
  startedAt: string;
  stoppedAt?: string;
  workflowId: string;
  data: {
    resultData: {
      runData: Record<string, unknown>;
    };
  };
  status: "success" | "error" | "waiting" | "running";
}

export interface N8nCredential {
  id: string;
  name: string;
  type: string;
  nodesAccess: Array<{
    nodeType: string;
    date: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Workflow Builder Types
// ============================================================================

export interface WorkflowBuildRequest {
  description: string;
  triggers?: string[];
  actions?: string[];
  integrations?: string[];
  agentId?: number;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  // Full workflow definition (optional - for complete templates)
  workflow?: N8nWorkflow;
  // Simplified node definitions for template building
  nodes?: Array<{
    type: string;
    name: string;
    position: [number, number];
    parameters?: Record<string, unknown>;
  }>;
  connections?: N8nConnections;
  variables?: string[];
  requiredCredentials?: string[];
  tags?: string[];
}

export type WorkflowCategory =
  | "automation"
  | "data-sync"
  | "data"
  | "notifications"
  | "notification"
  | "ai-agent"
  | "ai"
  | "integration"
  | "monitoring"
  | "utility"
  | "agent"
  | "meta"
  | "custom";

// ============================================================================
// Agent Communication Types
// ============================================================================

export interface AgentMessage {
  id: string;
  fromAgentId: number;
  toAgentId: number | "broadcast";
  type: AgentMessageType;
  payload: Record<string, unknown>;
  timestamp: number;
  replyTo?: string;
  status: "pending" | "delivered" | "processed" | "failed";
}

export type AgentMessageType =
  | "request"
  | "response"
  | "task"
  | "result"
  | "error"
  | "workflow-request"
  | "workflow-result"
  | "status-update";

export interface AgentCollaboration {
  id: string;
  name: string;
  agentIds: number[];
  workflowId?: string;
  status: "active" | "paused" | "completed";
  createdAt: number;
  messages: AgentMessage[];
}

// ============================================================================
// n8n Node Types (Common)
// ============================================================================

export const N8N_NODE_TYPES = {
  // Triggers
  WEBHOOK: "n8n-nodes-base.webhook",
  CRON: "n8n-nodes-base.cron",
  SCHEDULE: "n8n-nodes-base.scheduleTrigger",
  MANUAL: "n8n-nodes-base.manualTrigger",
  EMAIL_TRIGGER: "n8n-nodes-base.emailReadImap",
  
  // Core
  HTTP_REQUEST: "n8n-nodes-base.httpRequest",
  CODE: "n8n-nodes-base.code",
  FUNCTION: "n8n-nodes-base.function",
  SET: "n8n-nodes-base.set",
  IF: "n8n-nodes-base.if",
  SWITCH: "n8n-nodes-base.switch",
  MERGE: "n8n-nodes-base.merge",
  SPLIT_IN_BATCHES: "n8n-nodes-base.splitInBatches",
  WAIT: "n8n-nodes-base.wait",
  NO_OP: "n8n-nodes-base.noOp",
  
  // AI
  OPENAI: "n8n-nodes-base.openAi",
  AI_AGENT: "@n8n/n8n-nodes-langchain.agent",
  AI_CHAIN: "@n8n/n8n-nodes-langchain.chainLlm",
  AI_MEMORY: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
  AI_TOOL: "@n8n/n8n-nodes-langchain.toolWorkflow",
  AI_VECTOR_STORE: "@n8n/n8n-nodes-langchain.vectorStoreInMemory",
  
  // Integrations
  SLACK: "n8n-nodes-base.slack",
  DISCORD: "n8n-nodes-base.discord",
  TELEGRAM: "n8n-nodes-base.telegram",
  EMAIL: "n8n-nodes-base.emailSend",
  GOOGLE_SHEETS: "n8n-nodes-base.googleSheets",
  POSTGRES: "n8n-nodes-base.postgres",
  MYSQL: "n8n-nodes-base.mySql",
  MONGODB: "n8n-nodes-base.mongoDb",
  REDIS: "n8n-nodes-base.redis",
  
  // Workflow
  EXECUTE_WORKFLOW: "n8n-nodes-base.executeWorkflow",
  EXECUTE_WORKFLOW_TRIGGER: "n8n-nodes-base.executeWorkflowTrigger",
  RESPOND_TO_WEBHOOK: "n8n-nodes-base.respondToWebhook",
} as const;

// ============================================================================
// Meta Workflow Builder Types
// ============================================================================

export interface MetaWorkflowConfig {
  // Workflow that builds other workflows
  builderWorkflowId?: string;
  // Template library
  templates: WorkflowTemplate[];
  // Auto-optimization settings
  optimization: {
    enabled: boolean;
    maxNodes: number;
    errorHandling: boolean;
  };
}

export interface WorkflowGenerationRequest {
  prompt: string;
  context?: {
    availableCredentials: string[];
    existingWorkflows: string[];
    agentCapabilities: string[];
  };
  constraints?: {
    maxNodes?: number;
    requiredTrigger?: string;
    allowedIntegrations?: string[];
  };
}

export interface WorkflowGenerationResult {
  success: boolean;
  workflow?: N8nWorkflow;
  explanation?: string;
  warnings?: string[];
  errors?: string[];
}

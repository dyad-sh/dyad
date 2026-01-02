/**
 * Agent Builder Type Definitions
 * Types for building, configuring, and deploying AI agents
 */

// ============================================================================
// Core Agent Types
// ============================================================================

export type AgentType = "chatbot" | "task" | "multi-agent" | "workflow" | "rag";
export type AgentStatus = "draft" | "testing" | "deployed" | "archived";
export type DeploymentTarget = "local" | "docker" | "vercel" | "aws" | "custom";

export interface Agent {
  id: number;
  name: string;
  description?: string;
  type: AgentType;
  status: AgentStatus;
  appId?: number;
  systemPrompt?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  config?: AgentConfig;
  version: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfig {
  // Memory settings
  memory?: {
    type: "buffer" | "summary" | "vector";
    maxMessages?: number;
  };
  // Retry settings
  retry?: {
    maxRetries: number;
    backoffMs: number;
  };
  // Rate limiting
  rateLimit?: {
    requestsPerMinute: number;
  };
  // Tool configuration
  tools?: {
    enabled: string[];
    customTools: string[];
    mcpServers: string[];
  };
  // Custom settings
  custom?: Record<string, unknown>;
}

// ============================================================================
// Agent Tool Types
// ============================================================================

export interface AgentTool {
  id: number;
  agentId: number;
  name: string;
  description: string;
  inputSchema?: ToolInputSchema;
  implementationCode?: string;
  requiresApproval: boolean;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolParameterSchema>;
  required?: string[];
}

export interface ToolParameterSchema {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: ToolParameterSchema;
  default?: unknown;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  executionTimeMs?: number;
}

// ============================================================================
// Workflow Types
// ============================================================================

export interface AgentWorkflow {
  id: number;
  agentId: number;
  name: string;
  description?: string;
  definition?: WorkflowDefinition;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId: string;
  variables?: Record<string, WorkflowVariable>;
}

export type WorkflowNodeType =
  | "llm"
  | "tool"
  | "condition"
  | "loop"
  | "human"
  | "subagent"
  | "transform"
  | "api"
  | "code";

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  position?: { x: number; y: number };
  config: WorkflowNodeConfig;
}

export interface WorkflowNodeConfig {
  // For LLM nodes
  prompt?: string;
  modelId?: string;
  temperature?: number;

  // For tool nodes
  toolId?: number;
  toolName?: string;
  inputMapping?: Record<string, string>;

  // For condition nodes
  condition?: string;
  trueEdgeId?: string;
  falseEdgeId?: string;

  // For loop nodes
  maxIterations?: number;
  breakCondition?: string;

  // For human nodes
  message?: string;
  timeout?: number;

  // For subagent nodes
  subagentId?: number;

  // For transform nodes
  transformCode?: string;

  // For API nodes
  endpoint?: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string;

  // For code nodes
  code?: string;
  language?: "javascript" | "python";
}

export interface WorkflowEdge {
  id: string;
  sourceId: string;
  targetId: string;
  sourceHandle?: string;
  targetHandle?: string;
  condition?: string;
  label?: string;
}

export interface WorkflowVariable {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  defaultValue?: unknown;
}

export interface WorkflowExecution {
  id: string;
  workflowId: number;
  status: "running" | "completed" | "failed" | "paused";
  currentNodeId?: string;
  variables: Record<string, unknown>;
  history: WorkflowExecutionStep[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface WorkflowExecutionStep {
  nodeId: string;
  nodeName: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

// ============================================================================
// Deployment Types
// ============================================================================

export interface AgentDeployment {
  id: number;
  agentId: number;
  target: DeploymentTarget;
  config?: DeploymentConfig;
  endpoint?: string;
  status: DeploymentStatus;
  deployedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type DeploymentStatus =
  | "pending"
  | "building"
  | "deploying"
  | "deployed"
  | "failed"
  | "stopped";

export interface DeploymentConfig {
  // Environment variables
  envVars?: Record<string, string>;
  // Resource limits
  resources?: {
    memory?: string;
    cpu?: string;
  };
  // Scaling
  scaling?: {
    minInstances?: number;
    maxInstances?: number;
  };
  // Docker-specific
  docker?: {
    baseImage?: string;
    ports?: number[];
    volumes?: string[];
  };
  // Serverless-specific
  serverless?: {
    runtime?: string;
    timeout?: number;
    memorySize?: number;
  };
  // Custom deployment settings
  custom?: Record<string, unknown>;
}

// ============================================================================
// Testing Types
// ============================================================================

export interface AgentTestSession {
  id: number;
  agentId: number;
  messages?: AgentTestMessage[];
  metrics?: TestMetrics;
  createdAt: Date;
}

export interface AgentTestMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: AgentToolCall[];
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: "pending" | "completed" | "failed";
  error?: string;
}

export interface TestMetrics {
  totalMessages: number;
  averageResponseTime?: number;
  toolCallCount?: number;
  errorCount?: number;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

// ============================================================================
// Knowledge Base Types (for RAG agents)
// ============================================================================

export interface AgentKnowledgeBase {
  id: number;
  agentId: number;
  name: string;
  description?: string;
  sourceType: KnowledgeSourceType;
  sourceConfig?: KnowledgeBaseConfig;
  embeddingModel?: string;
  chunkSize: number;
  chunkOverlap: number;
  indexStatus: IndexStatus;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type KnowledgeSourceType = "files" | "urls" | "database" | "api" | "notion" | "github";
export type IndexStatus = "pending" | "indexing" | "indexed" | "failed";

export interface KnowledgeBaseConfig {
  // For file sources
  files?: KnowledgeFile[];
  // For URL sources
  urls?: string[];
  crawlDepth?: number;
  // For database sources
  connectionString?: string;
  query?: string;
  // For API sources
  apiEndpoint?: string;
  apiHeaders?: Record<string, string>;
  // For Notion sources
  notionToken?: string;
  notionPageIds?: string[];
  // For GitHub sources
  githubRepo?: string;
  githubBranch?: string;
  includePaths?: string[];
  excludePaths?: string[];
}

export interface KnowledgeFile {
  path: string;
  name: string;
  type: string;
  size: number;
  indexed: boolean;
}

export interface KnowledgeDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  chunkIndex?: number;
  sourceId: string;
}

// ============================================================================
// UI Component Types
// ============================================================================

export interface AgentUIComponent {
  id: number;
  agentId: number;
  name: string;
  componentType: UIComponentType;
  code?: string;
  propsSchema?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type UIComponentType =
  | "chat"
  | "form"
  | "dashboard"
  | "table"
  | "card"
  | "modal"
  | "sidebar"
  | "header"
  | "custom";

export interface UIComponentProps {
  // Chat component props
  chat?: {
    placeholder?: string;
    welcomeMessage?: string;
    showAvatar?: boolean;
    enableVoice?: boolean;
    enableFileUpload?: boolean;
  };
  // Form component props
  form?: {
    fields: FormField[];
    submitLabel?: string;
    layout?: "vertical" | "horizontal" | "grid";
  };
  // Dashboard component props
  dashboard?: {
    widgets: DashboardWidget[];
    layout?: string;
  };
}

export interface FormField {
  name: string;
  type: "text" | "number" | "email" | "select" | "checkbox" | "textarea" | "file";
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
}

export interface DashboardWidget {
  id: string;
  type: "chart" | "stat" | "table" | "list";
  title: string;
  config: Record<string, unknown>;
  position: { x: number; y: number; w: number; h: number };
}

// ============================================================================
// Agent Template Types
// ============================================================================

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  category: AgentTemplateCategory;
  thumbnail?: string;
  config: Partial<AgentConfig>;
  systemPrompt?: string;
  tools?: Partial<AgentTool>[];
  workflow?: Partial<WorkflowDefinition>;
  uiComponents?: Partial<AgentUIComponent>[];
}

export type AgentTemplateCategory =
  | "customer-service"
  | "data-analysis"
  | "content-creation"
  | "coding-assistant"
  | "research"
  | "automation"
  | "general";

// ============================================================================
// IPC Request/Response Types
// ============================================================================

export interface CreateAgentRequest {
  name: string;
  description?: string;
  type: AgentType;
  templateId?: string;
  systemPrompt?: string;
  modelId?: string;
  config?: Partial<AgentConfig>;
}

export interface UpdateAgentRequest {
  id: number;
  name?: string;
  description?: string;
  type?: AgentType;
  status?: AgentStatus;
  systemPrompt?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  config?: Partial<AgentConfig>;
}

export interface CreateAgentToolRequest {
  agentId: number;
  name: string;
  description: string;
  inputSchema?: ToolInputSchema;
  implementationCode?: string;
  requiresApproval?: boolean;
}

export interface UpdateAgentToolRequest {
  id: number;
  name?: string;
  description?: string;
  inputSchema?: ToolInputSchema;
  implementationCode?: string;
  requiresApproval?: boolean;
  enabled?: boolean;
}

export interface DeployAgentRequest {
  agentId: number;
  target: DeploymentTarget;
  config?: DeploymentConfig;
}

export interface TestAgentRequest {
  agentId: number;
  message: string;
  sessionId?: number;
}

export interface TestAgentResponse {
  sessionId: number;
  response: string;
  toolCalls?: AgentToolCall[];
  metrics?: Partial<TestMetrics>;
}

export interface ExportAgentRequest {
  agentId: number;
  format: "json" | "docker" | "standalone";
  includeUI?: boolean;
  includeKnowledgeBase?: boolean;
}

export interface ExportAgentResponse {
  success: boolean;
  exportPath?: string;
  error?: string;
}

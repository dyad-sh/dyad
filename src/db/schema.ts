import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import type { ModelMessage } from "ai";

export const AI_MESSAGES_SDK_VERSION = "ai@v5" as const;

export type AiMessagesJsonV5 = {
  messages: ModelMessage[];
  sdkVersion: typeof AI_MESSAGES_SDK_VERSION;
};

export const prompts = sqliteTable("prompts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  path: text("path").notNull(),
  color: text("color"),
  icon: text("icon"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  isFavorite: integer("is_favorite", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const apps = sqliteTable("apps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  projectId: integer("project_id").references(() => projects.id, { 
    onDelete: "set null" 
  }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  githubOrg: text("github_org"),
  githubRepo: text("github_repo"),
  githubBranch: text("github_branch"),
  supabaseProjectId: text("supabase_project_id"),
  // If supabaseProjectId is a branch, then the parent project id set.
  // This is because there's no way to retrieve ALL the branches for ALL projects
  // in a single API call
  // This is only used for display purposes but is NOT used for any actual
  // supabase management logic.
  supabaseParentProjectId: text("supabase_parent_project_id"),
  // Supabase organization slug for credential lookup
  supabaseOrganizationSlug: text("supabase_organization_slug"),
  neonProjectId: text("neon_project_id"),
  neonDevelopmentBranchId: text("neon_development_branch_id"),
  neonPreviewBranchId: text("neon_preview_branch_id"),
  vercelProjectId: text("vercel_project_id"),
  vercelProjectName: text("vercel_project_name"),
  vercelTeamId: text("vercel_team_id"),
  vercelDeploymentUrl: text("vercel_deployment_url"),
  installCommand: text("install_command"),
  startCommand: text("start_command"),
  chatContext: text("chat_context", { mode: "json" }),
  isFavorite: integer("is_favorite", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
});

export const chats = sqliteTable("chats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appId: integer("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  title: text("title"),
  initialCommitHash: text("initial_commit_hash"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chatId: integer("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  approvalState: text("approval_state", {
    enum: ["approved", "rejected"],
  }),
  // The commit hash of the codebase at the time the message was created
  sourceCommitHash: text("source_commit_hash"),
  // The commit hash of the codebase at the time the message was sent
  commitHash: text("commit_hash"),
  requestId: text("request_id"),
  // Max tokens used for this message (only for assistant messages)
  maxTokensUsed: integer("max_tokens_used"),
  // Model name used for this message (only for assistant messages)
  model: text("model"),
  // AI SDK messages (v5 envelope) for preserving tool calls/results in agent mode
  aiMessagesJson: text("ai_messages_json", {
    mode: "json",
  }).$type<AiMessagesJsonV5 | null>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const versions = sqliteTable(
  "versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    commitHash: text("commit_hash").notNull(),
    neonDbTimestamp: text("neon_db_timestamp"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    // Unique constraint to prevent duplicate versions
    unique("versions_app_commit_unique").on(table.appId, table.commitHash),
  ],
);

// Define relations
export const projectsRelations = relations(projects, ({ many }) => ({
  apps: many(apps),
}));

export const appsRelations = relations(apps, ({ many, one }) => ({
  chats: many(chats),
  versions: many(versions),
  project: one(projects, {
    fields: [apps.projectId],
    references: [projects.id],
  }),
}));

export const chatsRelations = relations(chats, ({ many, one }) => ({
  messages: many(messages),
  app: one(apps, {
    fields: [chats.appId],
    references: [apps.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  chat: one(chats, {
    fields: [messages.chatId],
    references: [chats.id],
  }),
}));

export const language_model_providers = sqliteTable(
  "language_model_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    api_base_url: text("api_base_url").notNull(),
    env_var_name: text("env_var_name"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
);

export const language_models = sqliteTable("language_models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
  apiName: text("api_name").notNull(),
  builtinProviderId: text("builtin_provider_id"),
  customProviderId: text("custom_provider_id").references(
    () => language_model_providers.id,
    { onDelete: "cascade" },
  ),
  description: text("description"),
  max_output_tokens: integer("max_output_tokens"),
  context_window: integer("context_window"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Define relations for new tables
export const languageModelProvidersRelations = relations(
  language_model_providers,
  ({ many }) => ({
    languageModels: many(language_models),
  }),
);

export const languageModelsRelations = relations(
  language_models,
  ({ one }) => ({
    provider: one(language_model_providers, {
      fields: [language_models.customProviderId],
      references: [language_model_providers.id],
    }),
  }),
);

export const versionsRelations = relations(versions, ({ one }) => ({
  app: one(apps, {
    fields: [versions.appId],
    references: [apps.id],
  }),
}));

// --- MCP (Model Context Protocol) tables ---
export const mcpServers = sqliteTable("mcp_servers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  transport: text("transport").notNull(),
  command: text("command"),
  // Store typed JSON for args and environment variables
  args: text("args", { mode: "json" }).$type<string[] | null>(),
  envJson: text("env_json", { mode: "json" }).$type<Record<
    string,
    string
  > | null>(),
  url: text("url"),
  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const mcpToolConsents = sqliteTable(
  "mcp_tool_consents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    consent: text("consent").notNull().default("ask"), // ask | always | denied
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [unique("uniq_mcp_consent").on(table.serverId, table.toolName)],
);

// --- AI Agent Builder tables ---

// Agent type enum-like values
export type AgentType = "chatbot" | "task" | "multi-agent" | "workflow" | "rag";

// Agent status
export type AgentStatus = "draft" | "testing" | "deployed" | "archived";

// Agent deployment target
export type DeploymentTarget = "local" | "docker" | "vercel" | "aws" | "custom";

// Main agents table
export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").$type<AgentType>().notNull().default("chatbot"),
  status: text("status").$type<AgentStatus>().notNull().default("draft"),
  // The app this agent belongs to (for UI generation)
  appId: integer("app_id").references(() => apps.id, { onDelete: "set null" }),
  // System prompt for the agent
  systemPrompt: text("system_prompt"),
  // Model configuration
  modelId: text("model_id"),
  temperature: integer("temperature"),
  maxTokens: integer("max_tokens"),
  // Agent configuration as JSON
  configJson: text("config_json", { mode: "json" }).$type<AgentConfig | null>(),
  // Version tracking
  version: text("version").notNull().default("1.0.0"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Agent tools - custom tools defined for agents
export const agentTools = sqliteTable("agent_tools", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  // Tool input schema (JSON Schema format)
  inputSchema: text("input_schema", { mode: "json" }).$type<Record<string, unknown>>(),
  // Tool implementation code
  implementationCode: text("implementation_code"),
  // Whether this tool requires user approval
  requiresApproval: integer("requires_approval", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  // Whether tool is enabled
  enabled: integer("enabled", { mode: "boolean" })
    .notNull()
    .default(sql`1`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Agent workflows - for multi-step agent execution
export const agentWorkflows = sqliteTable("agent_workflows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Workflow definition as JSON (nodes, edges, conditions)
  workflowJson: text("workflow_json", { mode: "json" }).$type<WorkflowDefinition | null>(),
  // Whether this is the default workflow
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Agent deployments - track where agents are deployed
export const agentDeployments = sqliteTable("agent_deployments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  target: text("target").$type<DeploymentTarget>().notNull(),
  // Deployment configuration
  deploymentConfigJson: text("deployment_config_json", { mode: "json" }).$type<DeploymentConfig | null>(),
  // Deployment URL or endpoint
  endpoint: text("endpoint"),
  // Deployment status
  deploymentStatus: text("deployment_status").notNull().default("pending"),
  // Last deployment timestamp
  deployedAt: integer("deployed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Agent test sessions - for testing agents before deployment
export const agentTestSessions = sqliteTable("agent_test_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  // Test session messages as JSON
  messagesJson: text("messages_json", { mode: "json" }).$type<AgentTestMessage[] | null>(),
  // Test results/metrics
  metricsJson: text("metrics_json", { mode: "json" }).$type<TestMetrics | null>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Agent knowledge bases - for RAG agents
export const agentKnowledgeBases = sqliteTable("agent_knowledge_bases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Source type: files, urls, database, api
  sourceType: text("source_type").notNull(),
  // Source configuration
  sourceConfigJson: text("source_config_json", { mode: "json" }).$type<KnowledgeBaseConfig | null>(),
  // Embedding model
  embeddingModel: text("embedding_model"),
  // Chunk settings
  chunkSize: integer("chunk_size").default(1000),
  chunkOverlap: integer("chunk_overlap").default(200),
  // Status
  indexStatus: text("index_status").notNull().default("pending"),
  documentCount: integer("document_count").default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Agent UI components - for full-stack agent UIs
export const agentUIComponents = sqliteTable("agent_ui_components", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Component type: chat, form, dashboard, etc.
  componentType: text("component_type").notNull(),
  // Component code/template
  code: text("code"),
  // Component props schema
  propsSchema: text("props_schema", { mode: "json" }).$type<Record<string, unknown> | null>(),
  // Styling configuration
  stylesJson: text("styles_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Type definitions for JSON columns
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
  // Custom settings
  custom?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId: string;
}

export interface WorkflowNode {
  id: string;
  type: "llm" | "tool" | "condition" | "loop" | "human" | "subagent";
  name: string;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  sourceId: string;
  targetId: string;
  condition?: string;
}

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
  // Custom deployment settings
  custom?: Record<string, unknown>;
}

export interface AgentTestMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    output?: unknown;
  }>;
}

export interface TestMetrics {
  totalMessages: number;
  averageResponseTime?: number;
  toolCallCount?: number;
  errorCount?: number;
}

export interface KnowledgeBaseConfig {
  // For file sources
  files?: string[];
  // For URL sources
  urls?: string[];
  // For database sources
  connectionString?: string;
  query?: string;
  // For API sources
  apiEndpoint?: string;
  apiHeaders?: Record<string, string>;
}

// Relations for agent tables
export const agentsRelations = relations(agents, ({ one, many }) => ({
  app: one(apps, {
    fields: [agents.appId],
    references: [apps.id],
  }),
  tools: many(agentTools),
  workflows: many(agentWorkflows),
  deployments: many(agentDeployments),
  testSessions: many(agentTestSessions),
  knowledgeBases: many(agentKnowledgeBases),
  uiComponents: many(agentUIComponents),
}));

export const agentToolsRelations = relations(agentTools, ({ one }) => ({
  agent: one(agents, {
    fields: [agentTools.agentId],
    references: [agents.id],
  }),
}));

export const agentWorkflowsRelations = relations(agentWorkflows, ({ one }) => ({
  agent: one(agents, {
    fields: [agentWorkflows.agentId],
    references: [agents.id],
  }),
}));

export const agentDeploymentsRelations = relations(agentDeployments, ({ one }) => ({
  agent: one(agents, {
    fields: [agentDeployments.agentId],
    references: [agents.id],
  }),
}));

export const agentTestSessionsRelations = relations(agentTestSessions, ({ one }) => ({
  agent: one(agents, {
    fields: [agentTestSessions.agentId],
    references: [agents.id],
  }),
}));

export const agentKnowledgeBasesRelations = relations(agentKnowledgeBases, ({ one }) => ({
  agent: one(agents, {
    fields: [agentKnowledgeBases.agentId],
    references: [agents.id],
  }),
}));

export const agentUIComponentsRelations = relations(agentUIComponents, ({ one }) => ({
  agent: one(agents, {
    fields: [agentUIComponents.agentId],
    references: [agents.id],
  }),
}));

// ============================================================================
// Agent Workspace Tables (Tasks, Knowledge Sources, Executions)
// ============================================================================

/** Agent workspace tasks — persistent task definitions */
export const agentWorkspaceTasks = sqliteTable("agent_workspace_tasks", {
  id: text("id").primaryKey(), // UUID
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull(), // AgentTaskType
  status: text("status").notNull().default("draft"), // AgentTaskStatus
  priority: text("priority").notNull().default("medium"), // TaskPriority
  executionMode: text("execution_mode").notNull().default("local"), // ExecutionMode
  toolId: text("tool_id"),
  triggerId: text("trigger_id"),
  inputJson: text("input_json", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  outputJson: text("output_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
  error: text("error"),
  dependenciesJson: text("dependencies_json", {
    mode: "json",
  }).$type<string[]>().default([]),
  recurring: integer("recurring", { mode: "boolean" }).notNull().default(sql`0`),
  cronExpression: text("cron_expression"),
  executionCount: integer("execution_count").notNull().default(0),
  lastExecutedAt: text("last_executed_at"),
  averageDurationMs: integer("average_duration_ms"),
  n8nNodeId: text("n8n_node_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Agent workspace task executions — execution history */
export const agentWorkspaceExecutions = sqliteTable("agent_workspace_executions", {
  id: text("id").primaryKey(), // UUID
  taskId: text("task_id")
    .notNull()
    .references(() => agentWorkspaceTasks.id, { onDelete: "cascade" }),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  durationMs: integer("duration_ms"),
  inputJson: text("input_json", { mode: "json" }).$type<Record<string, unknown>>().default({}),
  outputJson: text("output_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
  error: text("error"),
  logsJson: text("logs_json", { mode: "json" }).$type<Array<{
    timestamp: string;
    level: string;
    message: string;
    data?: unknown;
  }>>().default([]),
  metricsJson: text("metrics_json", { mode: "json" }).$type<Record<string, unknown>>().default({}),
});

/** Agent workspace knowledge sources — persistent knowledge connector configs */
export const agentWorkspaceKnowledgeSources = sqliteTable("agent_workspace_knowledge_sources", {
  id: text("id").primaryKey(), // UUID
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(), // KnowledgeSourceType
  status: text("status").notNull().default("pending"), // KnowledgeSourceStatus
  configJson: text("config_json", { mode: "json" }).$type<Record<string, unknown>>(),
  totalDocuments: integer("total_documents").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  lastSyncAt: text("last_sync_at"),
  syncIntervalMs: integer("sync_interval_ms"),
  autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(sql`0`),
  filtersJson: text("filters_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Relations for workspace tables
export const agentWorkspaceTasksRelations = relations(agentWorkspaceTasks, ({ one, many }) => ({
  agent: one(agents, {
    fields: [agentWorkspaceTasks.agentId],
    references: [agents.id],
  }),
  executions: many(agentWorkspaceExecutions),
}));

export const agentWorkspaceExecutionsRelations = relations(agentWorkspaceExecutions, ({ one }) => ({
  task: one(agentWorkspaceTasks, {
    fields: [agentWorkspaceExecutions.taskId],
    references: [agentWorkspaceTasks.id],
  }),
  agent: one(agents, {
    fields: [agentWorkspaceExecutions.agentId],
    references: [agents.id],
  }),
}));

export const agentWorkspaceKnowledgeSourcesRelations = relations(
  agentWorkspaceKnowledgeSources,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentWorkspaceKnowledgeSources.agentId],
      references: [agents.id],
    }),
  }),
);

// ============================================================================
// Document Creation Tables (LibreOffice Integration)
// ============================================================================

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: ["document", "spreadsheet", "presentation"] }).notNull(),
  format: text("format").notNull(), // odt, docx, ods, xlsx, odp, pptx, etc.
  status: text("status", { enum: ["draft", "generating", "ready", "error"] })
    .notNull()
    .default("draft"),
  filePath: text("file_path").notNull(),
  description: text("description"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  thumbnail: text("thumbnail"),
  size: integer("size"),
  // AI generation metadata
  aiPrompt: text("ai_prompt"),
  aiModel: text("ai_model"),
  aiProvider: text("ai_provider"),
  // Timestamps
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const documentTemplates = sqliteTable("document_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["document", "spreadsheet", "presentation"] }).notNull(),
  description: text("description"),
  category: text("category").notNull(),
  thumbnail: text("thumbnail"),
  content: text("content", { mode: "json" }),
  isBuiltin: integer("is_builtin", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const documentExports = sqliteTable("document_exports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  filePath: text("file_path").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Document relations
export const documentsRelations = relations(documents, ({ many }) => ({
  exports: many(documentExports),
}));

export const documentExportsRelations = relations(documentExports, ({ one }) => ({
  document: one(documents, {
    fields: [documentExports.documentId],
    references: [documents.id],
  }),
}));

// ============================================================================
// Dataset Studio Tables (Offline-First Dataset Creation)
// ============================================================================

/**
 * Studio Datasets - Dataset Studio's own dataset management table
 * Supports multimodal datasets with provenance, licensing, and publishing
 */
export const studioDatasets = sqliteTable("studio_datasets", {
  id: text("id").primaryKey(), // UUID v4
  name: text("name").notNull(),
  description: text("description"),
  
  // Type and modality info
  datasetType: text("dataset_type", {
    enum: ["custom", "training", "evaluation", "fine_tuning", "rag", "mixed"]
  }).notNull().default("custom"),
  supportedModalities: text("supported_modalities", { mode: "json" }).$type<string[]>(),
  
  // Statistics (cached for quick display)
  itemCount: integer("item_count").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  
  // Licensing
  license: text("license").notNull().default("cc-by-4.0"),
  licenseUrl: text("license_url"),
  
  // Creator info
  creatorName: text("creator_name"),
  creatorId: text("creator_id"),
  
  // Publishing status
  publishStatus: text("publish_status", {
    enum: ["draft", "local", "p2p_shared", "marketplace_pending", "marketplace_published"]
  }).notNull().default("draft"),
  
  // Tags for organization
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  
  // Schema definition (for structured datasets)
  schemaJson: text("schema_json", { mode: "json" }).$type<DatasetSchemaV2 | null>(),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Dataset Items - Individual data items with provenance tracking
 * Supports multimodal: text, image, audio, video, context packs
 */
export const datasetItems = sqliteTable("dataset_items", {
  id: text("id").primaryKey(), // UUID v4
  datasetId: text("dataset_id").notNull(), // Links to studio_datasets
  
  // Core identification
  modality: text("modality", { 
    enum: ["text", "image", "audio", "video", "context"] 
  }).notNull(),
  contentHash: text("content_hash").notNull(), // SHA-256 of content
  byteSize: integer("byte_size").notNull(),
  
  // Source tracking
  sourceType: text("source_type", {
    enum: ["captured", "imported", "generated", "api", "scraped"]
  }).notNull(),
  sourcePath: text("source_path"), // Original file path or URL
  
  // Generation lineage (for AI-generated content)
  generator: text("generator", {
    enum: ["local_model", "provider_api", "human", "hybrid"]
  }),
  lineageJson: text("lineage_json", { mode: "json" }).$type<ItemLineage | null>(),
  
  // Content pointers
  contentUri: text("content_uri").notNull(), // Content-addressed URI
  localPath: text("local_path"), // Optional convenience path
  thumbnailPath: text("thumbnail_path"), // For media items
  
  // Labels and annotations
  labelsJson: text("labels_json", { mode: "json" }).$type<ItemLabels | null>(),
  annotationsJson: text("annotations_json", { mode: "json" }).$type<ItemAnnotation[] | null>(),
  
  // Quality signals
  qualitySignalsJson: text("quality_signals_json", { mode: "json" }).$type<QualitySignals | null>(),
  
  // Rights and licensing
  license: text("license").notNull().default("unknown"),
  consentFlags: text("consent_flags", { mode: "json" }).$type<string[] | null>(),
  restrictions: text("restrictions", { mode: "json" }).$type<string[] | null>(),
  
  // Signatures
  creatorSignature: text("creator_signature"),
  signedAt: integer("signed_at", { mode: "timestamp" }),
  
  // Split assignment
  split: text("split", { enum: ["train", "val", "test", "unassigned"] })
    .notNull()
    .default("unassigned"),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Dataset Manifests - Versioned dataset packages
 */
export const datasetManifests = sqliteTable("dataset_manifests", {
  id: text("id").primaryKey(), // UUID v4
  datasetId: text("dataset_id").notNull(),
  version: text("version").notNull(), // Semver
  
  // Manifest content hash (for integrity)
  manifestHash: text("manifest_hash").notNull(),
  merkleRoot: text("merkle_root"), // Merkle tree root of all items
  
  // Schema definition
  schemaJson: text("schema_json", { mode: "json" }).$type<DatasetSchemaV2 | null>(),
  
  // Statistics
  statsJson: text("stats_json", { mode: "json" }).$type<DatasetStatsV2 | null>(),
  totalItems: integer("total_items").notNull().default(0),
  totalBytes: integer("total_bytes").notNull().default(0),
  
  // Splits info
  splitsJson: text("splits_json", { mode: "json" }).$type<SplitsInfo | null>(),
  
  // Licensing
  license: text("license").notNull(),
  licenseUrl: text("license_url"),
  
  // Publishing status
  publishStatus: text("publish_status", {
    enum: ["draft", "local", "p2p_shared", "marketplace_pending", "marketplace_published"]
  }).notNull().default("draft"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  marketplaceId: text("marketplace_id"),
  
  // Signatures
  creatorSignature: text("creator_signature"),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  unique("dataset_version_unique").on(table.datasetId, table.version),
]);

/**
 * Provenance Records - Track complete lineage of dataset items
 */
export const provenanceRecords = sqliteTable("provenance_records", {
  id: text("id").primaryKey(),
  itemId: text("item_id")
    .notNull()
    .references(() => datasetItems.id, { onDelete: "cascade" }),
  
  // Action tracking
  action: text("action", {
    enum: ["created", "imported", "generated", "transformed", "labeled", "merged", "split"]
  }).notNull(),
  
  // Actor
  actorType: text("actor_type", {
    enum: ["human", "local_model", "remote_api", "pipeline"]
  }).notNull(),
  actorId: text("actor_id"), // Model ID, user ID, or pipeline ID
  
  // Input/Output hashes for reproducibility
  inputHashesJson: text("input_hashes_json", { mode: "json" }).$type<string[] | null>(),
  outputHash: text("output_hash").notNull(),
  
  // Parameters used
  parametersJson: text("parameters_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
  
  // Timestamps
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * P2P Sync State - Track sync status with peers
 */
export const datasetP2pSync = sqliteTable("dataset_p2p_sync", {
  id: text("id").primaryKey(),
  datasetId: text("dataset_id").notNull(),
  peerId: text("peer_id").notNull(),
  peerName: text("peer_name"),
  
  // Sync state
  syncDirection: text("sync_direction", { enum: ["push", "pull", "bidirectional"] }).notNull(),
  lastSyncedVersion: text("last_synced_version"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  
  // Conflict tracking
  conflictState: text("conflict_state", {
    enum: ["none", "detected", "resolved", "manual_required"]
  }).notNull().default("none"),
  conflictDetailsJson: text("conflict_details_json", { mode: "json" }),
  
  // Status
  syncStatus: text("sync_status", {
    enum: ["idle", "syncing", "queued", "error"]
  }).notNull().default("idle"),
  errorMessage: text("error_message"),
  
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  unique("dataset_peer_unique").on(table.datasetId, table.peerId),
]);

/**
 * Content-Addressed Blob Registry - Track all stored blobs
 */
export const contentBlobs = sqliteTable("content_blobs", {
  hash: text("hash").primaryKey(), // SHA-256
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  storagePath: text("storage_path").notNull(), // Path in content-addressed store
  
  // Chunking info (for large files)
  isChunked: integer("is_chunked", { mode: "boolean" }).notNull().default(sql`0`),
  chunkCount: integer("chunk_count"),
  chunkHashes: text("chunk_hashes", { mode: "json" }).$type<string[] | null>(),
  
  // Reference counting
  refCount: integer("ref_count").notNull().default(1),
  
  // Pin status (prevent garbage collection)
  isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(sql`0`),
  
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Dataset Generation Jobs - Track AI generation tasks
 */
export const datasetGenerationJobs = sqliteTable("dataset_generation_jobs", {
  id: text("id").primaryKey(),
  datasetId: text("dataset_id").notNull(),
  
  // Job config
  jobType: text("job_type", {
    enum: ["text_generation", "image_generation", "audio_transcription", "labeling", "augmentation", "embedding"]
  }).notNull(),
  configJson: text("config_json", { mode: "json" }).$type<GenerationJobConfig | null>(),
  
  // Provider info
  providerType: text("provider_type", { enum: ["local", "remote"] }).notNull(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  
  // Progress tracking
  status: text("status", {
    enum: ["pending", "running", "paused", "completed", "failed", "cancelled"]
  }).notNull().default("pending"),
  progress: integer("progress").notNull().default(0), // 0-100
  totalItems: integer("total_items").notNull().default(0),
  completedItems: integer("completed_items").notNull().default(0),
  failedItems: integer("failed_items").notNull().default(0),
  
  // Checkpointing for resumability
  checkpointJson: text("checkpoint_json", { mode: "json" }),
  
  // Cost tracking (for remote APIs)
  estimatedCost: text("estimated_cost"),
  actualCost: text("actual_cost"),
  
  // Error handling
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// Dataset Studio Type Definitions
export interface ItemLineage {
  model?: string;
  modelVersion?: string;
  prompt?: string;
  systemPrompt?: string;
  seed?: number;
  temperature?: number;
  parameters?: Record<string, unknown>;
  parentItemIds?: string[];
  transformations?: string[];
}

export interface ItemLabels {
  tags?: string[];
  categories?: string[];
  boundingBoxes?: BoundingBox[];
  segmentationMask?: string;
  keypoints?: Keypoint[];
  caption?: string;
  transcript?: string;
  embedding?: number[];
  customLabels?: Record<string, unknown>;
}

export interface BoundingBox {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
}

export interface Keypoint {
  label: string;
  x: number;
  y: number;
  confidence?: number;
}

export interface ItemAnnotation {
  id: string;
  type: "note" | "correction" | "flag" | "review";
  content: string;
  author: string;
  createdAt: string;
}

export interface QualitySignals {
  // Image quality
  blurScore?: number;
  aestheticScore?: number;
  resolution?: { width: number; height: number };
  
  // Content safety
  nsfwScore?: number;
  toxicityScore?: number;
  
  // Text quality
  languageConfidence?: number;
  readabilityScore?: number;
  
  // Audio quality
  signalToNoiseRatio?: number;
  
  // General
  duplicateScore?: number;
  overallQuality?: number;
  customSignals?: Record<string, number>;
}

export interface DatasetSchemaV2 {
  version: string;
  modalities: string[];
  fields: SchemaField[];
  labelSchema?: Record<string, unknown>;
}

export interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "binary";
  required: boolean;
  description?: string;
  constraints?: Record<string, unknown>;
}

export interface DatasetStatsV2 {
  itemCount: number;
  totalBytes: number;
  modalityDistribution: Record<string, number>;
  labelDistribution?: Record<string, number>;
  qualityDistribution?: Record<string, { min: number; max: number; mean: number }>;
  splitDistribution: Record<string, number>;
}

export interface SplitsInfo {
  seed: number;
  ratios: { train: number; val: number; test: number };
  counts: { train: number; val: number; test: number };
}

export interface GenerationJobConfig {
  targetCount?: number;
  promptTemplate?: string;
  inputDatasetId?: string;
  augmentationConfig?: Record<string, unknown>;
  qualityThresholds?: Record<string, number>;
  outputModality?: string;
}

// Dataset Studio Relations
export const studioDatasetsRelations = relations(studioDatasets, ({ many }) => ({
  items: many(datasetItems),
  manifests: many(datasetManifests),
  generationJobs: many(datasetGenerationJobs),
}));

export const datasetItemsRelations = relations(datasetItems, ({ one, many }) => ({
  dataset: one(studioDatasets, {
    fields: [datasetItems.datasetId],
    references: [studioDatasets.id],
  }),
  provenanceRecords: many(provenanceRecords),
}));

export const datasetManifestsRelations = relations(datasetManifests, ({ one }) => ({
  dataset: one(studioDatasets, {
    fields: [datasetManifests.datasetId],
    references: [studioDatasets.id],
  }),
}));

export const datasetGenerationJobsRelations = relations(datasetGenerationJobs, ({ one }) => ({
  dataset: one(studioDatasets, {
    fields: [datasetGenerationJobs.datasetId],
    references: [studioDatasets.id],
  }),
}));

export const provenanceRecordsRelations = relations(provenanceRecords, ({ one }) => ({
  item: one(datasetItems, {
    fields: [provenanceRecords.itemId],
    references: [datasetItems.id],
  }),
}));

// =============================================================================
// JCN (JoyCreate Node) TABLES
// Production-grade state machines for publishing, jobs, and verification
// =============================================================================

/**
 * JCN Publish State Machine
 * Tracks the complete lifecycle of asset publishing with crash recovery
 */
export const jcnPublishRecords = sqliteTable("jcn_publish_records", {
  id: text("id").primaryKey(), // UUID v4
  requestId: text("request_id").notNull().unique(), // Idempotency key
  traceId: text("trace_id").notNull(),
  
  // Current state
  state: text("state", {
    enum: ["INIT", "BUNDLE_BUILT", "PINNED", "VERIFIED", "MINTED", "INDEXED", "COMPLETE", "FAILED", "RETRYABLE"]
  }).notNull().default("INIT"),
  
  // State history (JSON array)
  stateHistoryJson: text("state_history_json", { mode: "json" })
    .$type<Array<{ state: string; timestamp: number; event?: string; metadata?: Record<string, unknown> }>>()
    .notNull()
    .default([]),
  
  // Context
  storeId: text("store_id").notNull(),
  publisherWallet: text("publisher_wallet").notNull(),
  bundleType: text("bundle_type", {
    enum: ["ai_agent", "ai_model", "dataset", "prompt", "tool", "workflow"]
  }).notNull(),
  
  // Source
  sourcePath: text("source_path"),
  sourceType: text("source_type", { enum: ["local_path", "cid"] }).notNull().default("local_path"),
  
  // Bundle data
  bundleCid: text("bundle_cid"),
  manifestCid: text("manifest_cid"),
  manifestHash: text("manifest_hash"),
  merkleRoot: text("merkle_root"),
  totalSize: integer("total_size"),
  
  // Mint data
  mintTxHash: text("mint_tx_hash"),
  tokenId: text("token_id"),
  collectionContract: text("collection_contract"),
  
  // Marketplace data
  marketplaceAssetId: text("marketplace_asset_id"),
  
  // Metadata (JSON)
  metadataJson: text("metadata_json", { mode: "json" })
    .$type<{ name: string; description?: string; version: string; license: string; tags?: string[] }>(),
  
  // Pricing (JSON)
  pricingJson: text("pricing_json", { mode: "json" })
    .$type<{ model: string; amount?: number; currency?: string }>(),
  
  // Error tracking
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  errorRetryable: integer("error_retryable", { mode: "boolean" }).default(false),
  retryCount: integer("retry_count").notNull().default(0),
  lastRetryAt: integer("last_retry_at", { mode: "timestamp" }),
  
  // Checkpoint for recovery
  checkpointJson: text("checkpoint_json", { mode: "json" })
    .$type<{ lastCompletedStep: string; data: Record<string, unknown> }>(),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

/**
 * JCN Job State Machine
 * Tracks inference job execution with verification
 */
export const jcnJobRecords = sqliteTable("jcn_job_records", {
  id: text("id").primaryKey(), // UUID v4
  requestId: text("request_id").notNull().unique(), // Idempotency key
  traceId: text("trace_id").notNull(),
  
  // Current state
  state: text("state", {
    enum: ["PENDING", "VALIDATING", "FETCHING", "EXECUTING", "FINALIZING", "COMPLETED", "FAILED", "CANCELLED", "RETRYABLE"]
  }).notNull().default("PENDING"),
  
  // State history
  stateHistoryJson: text("state_history_json", { mode: "json" })
    .$type<Array<{ state: string; timestamp: number; event?: string; metadata?: Record<string, unknown> }>>()
    .notNull()
    .default([]),
  
  // Job ticket (JSON)
  ticketJson: text("ticket_json", { mode: "json" }).notNull(),
  
  // Validation results
  ticketValid: integer("ticket_valid", { mode: "boolean" }),
  licenseValid: integer("license_valid", { mode: "boolean" }),
  bundleVerified: integer("bundle_verified", { mode: "boolean" }),
  
  // Execution
  containerId: text("container_id"),
  inputCid: text("input_cid"),
  outputCid: text("output_cid"),
  outputHash: text("output_hash"),
  
  // Metrics
  startedAt: integer("started_at", { mode: "timestamp" }),
  executionDurationMs: integer("execution_duration_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  memoryPeakMb: integer("memory_peak_mb"),
  
  // Receipt
  receiptJson: text("receipt_json", { mode: "json" }),
  receiptCid: text("receipt_cid"),
  
  // Error tracking
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  errorRetryable: integer("error_retryable", { mode: "boolean" }).default(false),
  retryCount: integer("retry_count").notNull().default(0),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

/**
 * JCN Bundle Registry
 * Tracks all bundles pinned/verified by this node
 */
export const jcnBundles = sqliteTable("jcn_bundles", {
  id: text("id").primaryKey(), // UUID v4
  
  // Bundle identity
  bundleCid: text("bundle_cid").notNull().unique(),
  manifestCid: text("manifest_cid"),
  manifestHash: text("manifest_hash").notNull(),
  merkleRoot: text("merkle_root").notNull(),
  
  // Bundle metadata
  bundleType: text("bundle_type", {
    enum: ["ai_agent", "ai_model", "dataset", "prompt", "tool", "workflow"]
  }).notNull(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  description: text("description"),
  creator: text("creator").notNull(), // Wallet address
  
  // Content
  totalSize: integer("total_size").notNull(),
  fileCount: integer("file_count").notNull(),
  chunkCount: integer("chunk_count"),
  entryPoint: text("entry_point"),
  
  // Manifest (full JSON)
  manifestJson: text("manifest_json", { mode: "json" }),
  
  // Verification
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  verifiedAt: integer("verified_at", { mode: "timestamp" }),
  signatureValid: integer("signature_valid", { mode: "boolean" }),
  
  // Pin status (JSON array)
  pinStatusJson: text("pin_status_json", { mode: "json" })
    .$type<Array<{ provider: string; pinned: boolean; pinId?: string; verifiedAt?: number }>>()
    .default([]),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * JCN License Cache
 * Caches license validation results
 */
export const jcnLicenses = sqliteTable("jcn_licenses", {
  id: text("id").primaryKey(), // License ID
  
  // License identity
  licenseType: text("license_type", { enum: ["registry", "token", "signature"] }).notNull(),
  assetId: text("asset_id").notNull(), // Bundle CID or asset ID
  licensee: text("licensee").notNull(), // Wallet address
  licensor: text("licensor").notNull(), // Wallet address
  
  // Scope
  scope: text("scope").notNull(),
  
  // Limits (JSON)
  limitsJson: text("limits_json", { mode: "json" })
    .$type<{ maxInferences?: number; maxTokens?: number; expiresAt?: number }>(),
  
  // Usage tracking
  inferencesUsed: integer("inferences_used").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  
  // Verification
  verificationMethod: text("verification_method", {
    enum: ["contract_call", "token_ownership", "signature"]
  }).notNull(),
  contractAddress: text("contract_address"),
  tokenId: text("token_id"),
  signature: text("signature"),
  
  // Status
  valid: integer("valid", { mode: "boolean" }).notNull(),
  validatedAt: integer("validated_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  unique("license_asset_licensee").on(table.assetId, table.licensee),
]);

/**
 * JCN Chain Transactions
 * Tracks blockchain transactions with reorg handling
 */
export const jcnChainTransactions = sqliteTable("jcn_chain_transactions", {
  id: text("id").primaryKey(), // UUID v4
  
  // Transaction identity
  txHash: text("tx_hash").notNull().unique(),
  network: text("network", {
    enum: ["polygon", "polygon_mumbai", "ethereum", "base"]
  }).notNull(),
  
  // Status
  status: text("status", {
    enum: ["pending", "confirmed", "failed", "dropped", "reorged"]
  }).notNull().default("pending"),
  
  // Confirmation tracking
  blockNumber: integer("block_number"),
  confirmations: integer("confirmations").notNull().default(0),
  requiredConfirmations: integer("required_confirmations").notNull(),
  
  // Transaction type
  txType: text("tx_type", {
    enum: ["mint", "transfer", "list", "delist", "payout", "other"]
  }).notNull(),
  
  // Related record
  relatedRecordId: text("related_record_id"),
  relatedRecordType: text("related_record_type", {
    enum: ["publish", "job", "payout"]
  }),
  
  // Gas info
  gasUsed: text("gas_used"),
  gasPrice: text("gas_price"),
  
  // Timestamps
  submittedAt: integer("submitted_at", { mode: "timestamp" }).notNull(),
  confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * JCN Audit Log
 * Immutable audit trail for all significant actions
 */
export const jcnAuditLog = sqliteTable("jcn_audit_log", {
  id: text("id").primaryKey(), // UUID v4
  
  // Timestamp
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  
  // Action
  action: text("action").notNull(),
  
  // Actor
  actorType: text("actor_type", { enum: ["user", "system", "admin"] }).notNull(),
  actorId: text("actor_id").notNull(),
  actorWallet: text("actor_wallet"),
  
  // Target
  targetType: text("target_type", {
    enum: ["publish", "job", "bundle", "license", "key", "config"]
  }).notNull(),
  targetId: text("target_id").notNull(),
  
  // State change
  oldStateJson: text("old_state_json", { mode: "json" }),
  newStateJson: text("new_state_json", { mode: "json" }),
  
  // Context
  requestId: text("request_id"),
  traceId: text("trace_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  // Metadata
  metadataJson: text("metadata_json", { mode: "json" }),
});

/**
 * JCN Key Metadata
 * Tracks signing keys (actual keys stored in OS keyring/HSM)
 */
export const jcnKeys = sqliteTable("jcn_keys", {
  keyId: text("key_id").primaryKey(),
  
  // Key info
  keyType: text("key_type", { enum: ["signing", "encryption", "chain"] }).notNull(),
  algorithm: text("algorithm", { enum: ["secp256k1", "ed25519", "aes-256-gcm"] }).notNull(),
  backend: text("backend", { enum: ["os_keyring", "encrypted_vault", "hsm"] }).notNull(),
  
  // Public info (never store private keys here!)
  publicKey: text("public_key"),
  walletAddress: text("wallet_address"),
  
  // Status
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  
  // Rotation
  version: integer("version").notNull().default(1),
  lastRotatedAt: integer("last_rotated_at", { mode: "timestamp" }),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * JCN Rate Limits
 * Tracks rate limit state per scope
 */
export const jcnRateLimits = sqliteTable("jcn_rate_limits", {
  id: text("id").primaryKey(), // scope:endpoint:identifier
  
  // Scope
  scope: text("scope", { enum: ["user", "global", "store"] }).notNull(),
  endpoint: text("endpoint").notNull(),
  identifier: text("identifier").notNull(), // User ID, store ID, or "global"
  
  // State
  count: integer("count").notNull().default(0),
  windowStart: integer("window_start", { mode: "timestamp" }).notNull(),
  
  // Config
  maxRequests: integer("max_requests").notNull(),
  windowSec: integer("window_sec").notNull(),
});

// =============================================================================
// CREATOR LIFECYCLE
// Create → Verify → Use → Receipts → Rewards → Reputation → Better Create
// =============================================================================

/**
 * Lifecycle stage enum for asset progression
 */
export type LifecycleStage =
  | "created"
  | "verified"
  | "published"
  | "in_use"
  | "receipted"
  | "rewarded";

/**
 * Usage Events
 * Tracks every use of an asset (inference, download, fork, reference).
 */
export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(), // UUID v4

  // What was used
  assetId: text("asset_id").notNull(),
  assetType: text("asset_type", {
    enum: ["model", "dataset", "agent", "workflow", "prompt", "template", "plugin", "api"],
  }).notNull(),

  // How it was used
  eventType: text("event_type", {
    enum: ["inference", "download", "fork", "reference", "api_call", "embed", "fine_tune"],
  }).notNull(),

  // Who used it
  consumerId: text("consumer_id"), // wallet or local user ID
  consumerType: text("consumer_type", { enum: ["local", "network", "marketplace"] }),

  // Metering
  units: integer("units").notNull().default(1), // tokens, items, calls
  computeMs: integer("compute_ms"), // execution time
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  dataBytesProcessed: integer("data_bytes_processed"),

  // Context
  sessionId: text("session_id"),
  requestId: text("request_id"),
  modelId: text("model_id"),

  // Receipt link (filled after receipt creation)
  receiptId: text("receipt_id"),
  receiptCid: text("receipt_cid"),

  // Metadata
  metadataJson: text("metadata_json", { mode: "json" }).$type<Record<string, unknown> | null>(),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Verification Records
 * Tracks every verification action on an asset — quality gates, peer reviews, automated checks.
 */
export const verificationRecords = sqliteTable("verification_records", {
  id: text("id").primaryKey(), // UUID v4

  // What was verified
  assetId: text("asset_id").notNull(),
  assetType: text("asset_type", {
    enum: ["model", "dataset", "agent", "workflow", "prompt", "template", "plugin", "api"],
  }).notNull(),

  // Who verified
  verifierId: text("verifier_id").notNull(), // wallet, nodeId, or "system"
  verifierType: text("verifier_type", {
    enum: ["automated", "peer", "self", "system"],
  }).notNull(),

  // Verification type
  verificationType: text("verification_type", {
    enum: [
      "quality_check",
      "integrity_hash",
      "celestia_anchor",
      "peer_review",
      "license_compliance",
      "safety_scan",
      "benchmark",
      "format_validation",
    ],
  }).notNull(),

  // Outcome
  passed: integer("passed", { mode: "boolean" }).notNull(),
  score: integer("score"), // 0-100
  details: text("details"),
  errorMessage: text("error_message"),

  // Evidence
  evidenceJson: text("evidence_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
  evidenceCid: text("evidence_cid"), // IPLD CID of proof

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Rewards Ledger
 * Double-entry-style ledger tracking every reward earned or paid out.
 */
export const rewardsLedger = sqliteTable("rewards_ledger", {
  id: text("id").primaryKey(), // UUID v4

  // Who gets rewarded
  recipientId: text("recipient_id").notNull(), // wallet address or local user id
  recipientType: text("recipient_type", {
    enum: ["creator", "validator", "curator", "compute_provider"],
  }).notNull(),

  // What triggered the reward
  triggerType: text("trigger_type", {
    enum: [
      "usage_fee",
      "verification_reward",
      "curation_reward",
      "compute_reward",
      "quality_bonus",
      "streak_bonus",
      "referral",
    ],
  }).notNull(),
  triggerEventId: text("trigger_event_id"), // usageEvents.id, verificationRecords.id, etc.

  // Amount
  amount: text("amount").notNull(), // string for precision (could be wei)
  currency: text("currency", {
    enum: ["JOY", "TIA", "USDC", "MATIC", "points"],
  }).notNull(),

  // Status
  status: text("status", {
    enum: ["pending", "confirmed", "paid_out", "failed", "expired"],
  }).notNull().default("pending"),

  // On-chain reference
  txHash: text("tx_hash"),
  network: text("network"),

  // Related asset
  assetId: text("asset_id"),
  assetType: text("asset_type"),

  // Metadata
  metadataJson: text("metadata_json", { mode: "json" }).$type<Record<string, unknown> | null>(),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  paidOutAt: integer("paid_out_at", { mode: "timestamp" }),
});

/**
 * Reputation Scores
 * Aggregated reputation for each identity, computed from the lifecycle signals.
 */
export const reputationScores = sqliteTable("reputation_scores", {
  id: text("id").primaryKey(), // recipientId (wallet or local user)

  // Overall score
  overallScore: integer("overall_score").notNull().default(0), // 0-1000

  // Component scores (0-1000 each)
  creationScore: integer("creation_score").notNull().default(0),
  verificationScore: integer("verification_score").notNull().default(0),
  usageScore: integer("usage_score").notNull().default(0),
  rewardScore: integer("reward_score").notNull().default(0),
  consistencyScore: integer("consistency_score").notNull().default(0),

  // Trust tier
  tier: text("tier", {
    enum: ["newcomer", "contributor", "trusted", "verified", "elite"],
  }).notNull().default("newcomer"),

  // Stats
  totalAssetsCreated: integer("total_assets_created").notNull().default(0),
  totalVerificationsPassed: integer("total_verifications_passed").notNull().default(0),
  totalVerificationsFailed: integer("total_verifications_failed").notNull().default(0),
  totalUsageEvents: integer("total_usage_events").notNull().default(0),
  totalRewardsEarned: text("total_rewards_earned").notNull().default("0"),
  totalReceiptsGenerated: integer("total_receipts_generated").notNull().default(0),

  // Streak tracking
  currentStreak: integer("current_streak").notNull().default(0), // consecutive days active
  longestStreak: integer("longest_streak").notNull().default(0),
  lastActiveAt: integer("last_active_at", { mode: "timestamp" }),

  // Quality
  averageQualityScore: integer("average_quality_score"), // 0-100

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Lifecycle Events
 * Audit log of every stage transition in the Create→...→Better Create loop.
 */
export const lifecycleEvents = sqliteTable("lifecycle_events", {
  id: text("id").primaryKey(), // UUID v4

  // Asset
  assetId: text("asset_id").notNull(),
  assetType: text("asset_type", {
    enum: ["model", "dataset", "agent", "workflow", "prompt", "template", "plugin", "api"],
  }).notNull(),

  // Stage transition
  stage: text("stage", {
    enum: ["created", "verified", "published", "in_use", "receipted", "rewarded"],
  }).notNull(),
  previousStage: text("previous_stage"),

  // Actor
  actorId: text("actor_id").notNull(),

  // Evidence / links
  relatedEventId: text("related_event_id"), // points to usage_events, verification_records, etc.
  relatedEventType: text("related_event_type"),
  receiptCid: text("receipt_cid"),
  celestiaBlobHash: text("celestia_blob_hash"),

  // Metadata
  metadataJson: text("metadata_json", { mode: "json" }).$type<Record<string, unknown> | null>(),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Creator Feedback
 * Feedback entries that close the loop — "Better Create" stage.
 */
export const creatorFeedback = sqliteTable("creator_feedback", {
  id: text("id").primaryKey(), // UUID v4

  // Asset
  assetId: text("asset_id").notNull(),
  assetType: text("asset_type", {
    enum: ["model", "dataset", "agent", "workflow", "prompt", "template", "plugin", "api"],
  }).notNull(),

  // Feedback type
  feedbackType: text("feedback_type", {
    enum: [
      "quality_suggestion",
      "usage_insight",
      "improvement_tip",
      "peer_review_note",
      "auto_recommendation",
      "benchmark_result",
    ],
  }).notNull(),

  // Content
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority", { enum: ["low", "medium", "high", "critical"] })
    .notNull()
    .default("medium"),

  // Status
  status: text("status", {
    enum: ["new", "acknowledged", "in_progress", "resolved", "dismissed"],
  }).notNull().default("new"),

  // Source
  sourceType: text("source_type", {
    enum: ["system", "peer", "analytics", "quality_engine", "user"],
  }).notNull(),
  sourceId: text("source_id"),

  // Data
  dataJson: text("data_json", { mode: "json" }).$type<Record<string, unknown> | null>(),

  // Resolution
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  resolutionNote: text("resolution_note"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ── OpenClaw Kanban ──────────────────────────────────────────
// Track what OpenClaw is working on, what's queued, completed, failed, etc.

export const openclawKanbanTasks = sqliteTable("openclaw_kanban_tasks", {
  id: text("id").primaryKey(), // UUID v4
  title: text("title").notNull(),
  description: text("description"),

  // Board status
  status: text("status", {
    enum: ["backlog", "todo", "in_progress", "review", "completed", "failed", "cancelled"],
  }).notNull().default("backlog"),

  // Task classification
  taskType: text("task_type", {
    enum: [
      "research", "build", "analyze", "optimize", "automate",
      "code_generation", "refactor", "debug", "deploy",
      "data_pipeline", "agent_task", "workflow", "custom",
    ],
  }).notNull().default("custom"),

  priority: text("priority", {
    enum: ["critical", "high", "medium", "low"],
  }).notNull().default("medium"),

  // OpenClaw execution context
  provider: text("provider"), // e.g. "ollama", "anthropic", "claude-code"
  model: text("model"), // e.g. "llama3", "claude-sonnet-4-20250514"
  agentId: text("agent_id"), // If spawned by an agent
  workflowId: text("workflow_id"), // n8n workflow if applicable
  parentTaskId: text("parent_task_id"), // For sub-task trees

  // Execution metrics
  tokensUsed: integer("tokens_used").default(0),
  iterationsRun: integer("iterations_run").default(0),
  costEstimate: text("cost_estimate"), // stored as string for precision
  durationMs: integer("duration_ms"),
  localProcessed: integer("local_processed", { mode: "boolean" }).default(sql`0`),

  // Result
  resultJson: text("result_json", { mode: "json" }).$type<Record<string, unknown> | null>(),
  errorMessage: text("error_message"),

  // Artifacts produced (files created, code generated, etc.)
  artifactsJson: text("artifacts_json", { mode: "json" }).$type<Array<{
    id: string;
    type: string;
    name: string;
    path?: string;
    language?: string;
  }> | null>(),

  // Labels / tags for filtering
  labels: text("labels", { mode: "json" }).$type<string[] | null>(),

  // Assignee (which OpenClaw subsystem or user)
  assignee: text("assignee"),

  // Ordering within a column
  sortOrder: integer("sort_order").default(0),

  // Timestamps
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const openclawKanbanTaskRelations = relations(openclawKanbanTasks, ({ many }) => ({
  activities: many(openclawKanbanActivity),
}));

export const openclawKanbanActivity = sqliteTable("openclaw_kanban_activity", {
  id: text("id").primaryKey(), // UUID v4
  taskId: text("task_id").notNull(),

  action: text("action", {
    enum: [
      "created", "status_changed", "priority_changed", "assigned",
      "comment", "started", "completed", "failed", "retried",
      "label_added", "label_removed", "artifact_added",
    ],
  }).notNull(),

  fromValue: text("from_value"),
  toValue: text("to_value"),
  note: text("note"),
  actor: text("actor").default("openclaw"), // "openclaw", "user", agent name, etc.

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const openclawKanbanActivityRelations = relations(openclawKanbanActivity, ({ one }) => ({
  task: one(openclawKanbanTasks, {
    fields: [openclawKanbanActivity.taskId],
    references: [openclawKanbanTasks.id],
  }),
}));

// ── Local Vault (Sovereign Data Vault) ────────────────────────
export * from "./vault_schema";

// ── Multi-Armed Bandit Learning (Continuous Improvement Memory) ────
export * from "./mab_schema";

// ── Agent Memory (Long-Term + Short-Term) ────────────────────
export * from "./agent_memory_schema";

// ── Data Flywheel (Self-Reinforcing Training Loop) ────────────
export * from "./flywheel_schema";

// ── Decentralized Model Registry ──────────────────────────────
export * from "./model_registry_schema";

// ── Self-Sovereign Identity (SSI) ─────────────────────────────
export * from "./ssi_schema";

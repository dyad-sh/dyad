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

export const apps = sqliteTable("apps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull(),
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
export const appsRelations = relations(apps, ({ many }) => ({
  chats: many(chats),
  versions: many(versions),
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

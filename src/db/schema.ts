import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import type { ModelMessage } from "ai";
import type { StoredChatMode } from "@/lib/schemas";

export const AI_MESSAGES_SDK_VERSION = "ai@v6" as const;

export type AiMessagesJsonV6 = {
  messages: ModelMessage[];
  sdkVersion: typeof AI_MESSAGES_SDK_VERSION;
};

export const prompts = sqliteTable(
  "prompts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    description: text("description"),
    content: text("content").notNull(),
    slug: text("slug"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [unique("prompts_slug_unique").on(table.slug)],
);

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
  neonActiveBranchId: text("neon_active_branch_id"),
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
  // Theme ID for design system theming (null means "no theme")
  themeId: text("theme_id"),
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
  // Context compaction fields
  compactedAt: integer("compacted_at", { mode: "timestamp" }),
  compactionBackupPath: text("compaction_backup_path"),
  pendingCompaction: integer("pending_compaction", { mode: "boolean" }),
  chatMode: text("chat_mode").$type<StoredChatMode | null>(),
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
  }).$type<AiMessagesJsonV6 | null>(),
  // Track if this message used the free agent quota (for non-Pro users)
  usingFreeAgentModeQuota: integer("using_free_agent_mode_quota", {
    mode: "boolean",
  }),
  // Indicates this message is a compaction summary
  isCompactionSummary: integer("is_compaction_summary", { mode: "boolean" }),
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
    {
      onDelete: "cascade",
    },
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
  headersJson: text("headers_json", { mode: "json" }).$type<Record<
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

// --- Custom Themes table ---
export const customThemes = sqliteTable("custom_themes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  prompt: text("prompt").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// --- Agent OS: user-registered agents (Multi-Agent Command Center) ---
export const agentOsAgents = sqliteTable("agent_os_agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Hermes | OpenClaw | MCP | Custom
  type: text("type").notNull().default("Custom"),
  endpoint: text("endpoint").notNull().default(""),
  // Where this agent serves images it generated, e.g. https://host/images.
  // Blank means "derive it from the endpoint origin".
  imageBaseUrl: text("image_base_url").notNull().default(""),
  model: text("model").notNull().default(""),
  // Stored locally on this machine; never returned to the renderer in plaintext.
  apiKey: text("api_key"),
  // JSON-encoded string[] of capability tags.
  capabilities: text("capabilities").notNull().default("[]"),
  icon: text("icon").notNull().default("🤖"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // online | idle | offline | error
  status: text("status").notNull().default("idle"),
  taskCount: integer("task_count").notNull().default(0),
  lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Connected external data sources, and the schema MyMeta has discovered in
 * them.
 *
 * This is a local-first single-user application: there is no workspace or
 * organisation table to scope rows against, so these carry no tenant column.
 * The trust boundary is the main process, not a tenant id. Every field the
 * renderer is allowed to see is safe metadata; the credential never leaves
 * here in plaintext.
 */
export const dataSources = sqliteTable("data_sources", {
  id: text("id").primaryKey(),
  // supabase today; postgres, mysql, bigquery and the rest later. Kept as a
  // column rather than a hard-coded assumption so a second provider does not
  // require a migration.
  provider: text("provider").notNull().default("supabase"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  projectUrl: text("project_url").notNull(),
  /**
   * Encrypted through the same safeStorage path as every other secret in the
   * app, stored as the JSON of a Secret ({value, encryptionType}). Decrypted
   * only in the main process, immediately before a connection is opened, and
   * never returned to the renderer or put into a model prompt.
   */
  encryptedCredential: text("encrypted_credential"),
  /**
   * Short, quotable identifier for the saved key, e.g. SUP-8F3A21.
   *
   * Exists so a card and a support conversation can name a credential without
   * naming the secret. Generated from random bytes rather than derived from
   * the key, because anything derived from a secret leaks a little of it.
   */
  keyId: text("key_id").notNull().default(""),
  // publishable | anon | secret | service_role
  credentialType: text("credential_type").notNull().default("secret"),
  /**
   * Postgres connection string, encrypted the same way.
   *
   * Kept separate from the API credential rather than overloading one column:
   * they grant different access, are rotated independently, and one may be
   * present without the other. Schema introspection needs this one, because
   * PostgREST cannot read information_schema or pg_catalog.
   */
  encryptedConnectionString: text("encrypted_connection_string"),
  // production | staging | development | other
  environment: text("environment").notNull().default("development"),
  // Read-only is the only mode version one accepts. The column exists so a
  // future write mode is a value change rather than a schema change.
  accessMode: text("access_mode").notNull().default("read_only"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  // connected | connection_error | auth_error | syncing | disabled | unknown
  status: text("status").notNull().default("unknown"),
  // Human-readable reason for a non-connected status. Never holds a secret.
  statusMessage: text("status_message").notNull().default(""),
  lastConnectedAt: integer("last_connected_at", { mode: "timestamp" }),
  lastSchemaSyncAt: integer("last_schema_sync_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const dataSourceTables = sqliteTable(
  "data_source_tables",
  {
    id: text("id").primaryKey(),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    schemaName: text("schema_name").notNull(),
    tableName: text("table_name").notNull(),
    // table | view | materialized_view
    tableType: text("table_type").notNull().default("table"),
    /** Comment read from the database. Authoritative. */
    description: text("description").notNull().default(""),
    /**
     * Inferred meaning, generated by us from names, types and relationships.
     * Deliberately a separate column from `description` so an answer can say
     * which of the two it relied on: one is what the database asserts, the
     * other is our guess.
     */
    semanticDescription: text("semantic_description").notNull().default(""),
    estimatedRows: integer("estimated_rows"),
    syncedAt: integer("synced_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    unique("data_source_tables_unique").on(
      table.dataSourceId,
      table.schemaName,
      table.tableName,
    ),
  ],
);

export const dataSourceColumns = sqliteTable(
  "data_source_columns",
  {
    id: text("id").primaryKey(),
    tableId: text("table_id")
      .notNull()
      .references(() => dataSourceTables.id, { onDelete: "cascade" }),
    columnName: text("column_name").notNull(),
    dataType: text("data_type").notNull(),
    nullable: integer("nullable", { mode: "boolean" }).notNull().default(true),
    defaultValue: text("default_value"),
    primaryKey: integer("primary_key", { mode: "boolean" })
      .notNull()
      .default(false),
    isUnique: integer("is_unique", { mode: "boolean" })
      .notNull()
      .default(false),
    description: text("description").notNull().default(""),
    semanticDescription: text("semantic_description").notNull().default(""),
    /**
     * JSON-encoded string[] of keys discovered inside a json/jsonb column by
     * bounded sampling. Empty when the column is not JSON or nothing was
     * sampled; never assumed to be the complete set.
     */
    jsonKeys: text("json_keys").notNull().default("[]"),
  },
  (table) => [
    unique("data_source_columns_unique").on(table.tableId, table.columnName),
  ],
);

export const dataSourceRelationships = sqliteTable(
  "data_source_relationships",
  {
    id: text("id").primaryKey(),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    sourceSchema: text("source_schema").notNull(),
    sourceTable: text("source_table").notNull(),
    sourceColumn: text("source_column").notNull(),
    targetSchema: text("target_schema").notNull(),
    targetTable: text("target_table").notNull(),
    targetColumn: text("target_column").notNull(),
    // foreign_key today; inferred relationships could follow.
    relationshipType: text("relationship_type")
      .notNull()
      .default("foreign_key"),
    constraintName: text("constraint_name").notNull().default(""),
  },
);

/**
 * What the AI actually ran.
 *
 * Records the shape of each query, never its results and never a credential:
 * an audit trail that itself leaks the data it is auditing is worse than none.
 */
export const dataSourceQueryLogs = sqliteTable("data_source_query_logs", {
  id: text("id").primaryKey(),
  dataSourceId: text("data_source_id").notNull(),
  chatId: integer("chat_id"),
  // JSON-encoded string[] of "schema.table" touched by the query.
  tablesAccessed: text("tables_accessed").notNull().default("[]"),
  // select | aggregate | search | describe
  queryType: text("query_type").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  executionMs: integer("execution_ms").notNull().default(0),
  // ok | rejected | error | timeout
  status: text("status").notNull(),
  // Why a query was rejected or failed. Sanitised before it is written.
  message: text("message").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Data sources a conversation is allowed to reach, restored when reopened. */
export const chatDataSources = sqliteTable(
  "chat_data_sources",
  {
    id: text("id").primaryKey(),
    chatId: integer("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    unique("chat_data_sources_unique").on(table.chatId, table.dataSourceId),
  ],
);

/**
 * Projects: a named working context that spans the app.
 *
 * A project carries standing instructions the assistant should follow while it
 * is active, so "we use British spelling and Postgres" is said once rather than
 * at the top of every conversation.
 *
 * Deliberately not a container that owns chats or files. Making it one would
 * mean moving existing conversations into it and deciding what happens to the
 * ones that belong nowhere; this earns its place first by changing what the
 * assistant knows, and can grow to hold things later.
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** Prepended to the assistant's system prompt while this project is active. */
  instructions: text("instructions"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

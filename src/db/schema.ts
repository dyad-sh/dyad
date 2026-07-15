import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
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

export const appCollections = sqliteTable(
  "app_collections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [unique("app_collections_name_unique").on(table.name)],
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
  // In-flight ephemeral test-user id for isolated e2e runs against Supabase.
  // Supabase's free tier has no DB branching, so instead of a throwaway branch
  // we create a dedicated throwaway auth user (via the Auth Admin API, stamped
  // app_metadata.dyad_test=true) and run the tests authenticated as it. Set
  // while a test session holds that user, cleared on teardown. Persisted so a
  // crash mid-session can be reconciled (orphan user deleted) on the next
  // launch. See ipc/utils/supabase_test_user.ts.
  supabaseTestUserId: text("supabase_test_user_id"),
  neonProjectId: text("neon_project_id"),
  neonDevelopmentBranchId: text("neon_development_branch_id"),
  neonPreviewBranchId: text("neon_preview_branch_id"),
  neonActiveBranchId: text("neon_active_branch_id"),
  // In-flight ephemeral test branch for isolated e2e test runs. Set while a
  // test session holds a throwaway copy-on-write branch, cleared on teardown.
  // Persisted so a crash mid-session can be reconciled (orphan branch deleted)
  // on the next launch. See ipc/utils/neon_test_branch.ts.
  neonTestBranchId: text("neon_test_branch_id"),
  neonProductionAuthCookieSecret: text("neon_production_auth_cookie_secret"),
  neonDevelopmentAuthCookieSecret: text("neon_development_auth_cookie_secret"),
  // Which Neon branch the unified database section is set to deploy/sync
  // against ("production" | "development"). Null is interpreted differently by
  // each consumer: the backend sync (getSelectedDeployBranchType) treats null
  // as production, while the DatabaseSection UI treats null as "not yet chosen"
  // and shows the branch picker until the user selects one.
  // Read by the main process when syncing env vars + trusted domains to Vercel.
  selectedDatabaseBranchType: text("selected_database_branch_type").$type<
    "production" | "development"
  >(),
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
  needsAppBlueprint: integer("needs_app_blueprint", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  // Per-app opt-in for the experimental AI E2E testing feature. Off by default:
  // running tests can mutate the app's real data, so the Tests panel gates all
  // run/generate controls behind this flag until the user explicitly enables it
  // (after acknowledging the data-backup warning). See TestsPanel.tsx.
  testingEnabled: integer("testing_enabled", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  collectionId: integer("collection_id").references(() => appCollections.id, {
    onDelete: "set null",
  }),
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
  isFavorite: integer("is_favorite", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
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
    isFavorite: integer("is_favorite", { mode: "boolean" })
      .notNull()
      .default(sql`0`),
    note: text("note"),
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

export const security_fix_chats = sqliteTable(
  "security_fix_chats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    reviewChatId: integer("review_chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    // Hash of the normalized finding(s) the fix chat was created for
    findingKey: text("finding_key").notNull(),
    fixChatId: integer("fix_chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    unique("security_fix_chats_unique").on(
      table.appId,
      table.reviewChatId,
      table.findingKey,
    ),
    index("security_fix_chats_review_chat_id_idx").on(table.reviewChatId),
    index("security_fix_chats_fix_chat_id_idx").on(table.fixChatId),
  ],
);

// Define relations
export const appsRelations = relations(apps, ({ many, one }) => ({
  chats: many(chats),
  versions: many(versions),
  securityFixChats: many(security_fix_chats),
  collection: one(appCollections, {
    fields: [apps.collectionId],
    references: [appCollections.id],
  }),
}));

export const appCollectionsRelations = relations(
  appCollections,
  ({ many }) => ({
    apps: many(apps),
  }),
);

export const chatsRelations = relations(chats, ({ many, one }) => ({
  messages: many(messages),
  securityFixReviewMappings: many(security_fix_chats, {
    relationName: "securityFixReviewChat",
  }),
  securityFixChatMappings: many(security_fix_chats, {
    relationName: "securityFixChat",
  }),
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

export const securityFixChatsRelations = relations(
  security_fix_chats,
  ({ one }) => ({
    app: one(apps, {
      fields: [security_fix_chats.appId],
      references: [apps.id],
    }),
    reviewChat: one(chats, {
      fields: [security_fix_chats.reviewChatId],
      references: [chats.id],
      relationName: "securityFixReviewChat",
    }),
    fixChat: one(chats, {
      fields: [security_fix_chats.fixChatId],
      references: [chats.id],
      relationName: "securityFixChat",
    }),
  }),
);

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
  // Whether this server requires OAuth. When true, the MCP manager wires
  // an `OAuthClientProvider` into the streamable HTTP transport so the
  // Vercel `@ai-sdk/mcp` `auth()` flow can drive PKCE + refresh.
  oauthEnabled: integer("oauth_enabled", { mode: "boolean" })
    .notNull()
    .default(sql`0`),
  // OAuth state (tokens, expiry, client info). Encrypted via Electron
  // `safeStorage`, or base64 plaintext where no keyring is available
  // (see encryptToString). Read/written only by DyadOAuthClientProvider.
  oauthState: text("oauth_state"),
  // Optional pre-registered OAuth client_id for servers that don't
  // support dynamic client registration (RFC 7591). User-supplied via
  // the add-server UI; left blank for servers that support DCR.
  oauthClientId: text("oauth_client_id"),
  // Optional pre-registered OAuth client_secret for confidential
  // clients. Encrypted via `safeStorage` (base64 plaintext fallback
  // where no keyring exists). Never sent to the renderer.
  oauthClientSecret: text("oauth_client_secret"),
  // Space-separated OAuth scopes requested at the authorize endpoint.
  // Server-defined values; check provider docs. Blank means omit the
  // `scope` parameter entirely so the server applies its own default
  // (rather than us guessing a value that fits a minority of providers).
  oauthScope: text("oauth_scope"),
  // Per-server callback port. Manual (non-DCR) flows pre-register a
  // redirect URI that includes the port, so it must stay stable for
  // those rows. Null falls back to DEFAULT_OAUTH_CALLBACK_PORT.
  oauthCallbackPort: integer("oauth_callback_port"),
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

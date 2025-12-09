import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  jsonb,
  unique,
  integer,
} from "drizzle-orm/pg-core";

export const prompts = pgTable("prompts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const apps = pgTable("apps", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path"), // Nullable for web mode where no file system exists
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  githubOrg: text("github_org"),
  githubRepo: text("github_repo"),
  githubBranch: text("github_branch"),
  supabaseProjectId: text("supabase_project_id"),
  supabaseParentProjectId: text("supabase_parent_project_id"),
  neonProjectId: text("neon_project_id"),
  neonDevelopmentBranchId: text("neon_development_branch_id"),
  neonPreviewBranchId: text("neon_preview_branch_id"),
  vercelProjectId: text("vercel_project_id"),
  vercelProjectName: text("vercel_project_name"),
  vercelTeamId: text("vercel_team_id"),
  vercelDeploymentUrl: text("vercel_deployment_url"),
  installCommand: text("install_command"),
  startCommand: text("start_command"),
  chatContext: jsonb("chat_context"),
  isFavorite: boolean("is_favorite").default(false).notNull(),
});

export const chats = pgTable("chats", {
  id: serial("id").primaryKey(),
  appId: integer("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  title: text("title"),
  initialCommitHash: text("initial_commit_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  approvalState: text("approval_state", {
    enum: ["approved", "rejected"],
  }),
  sourceCommitHash: text("source_commit_hash"),
  commitHash: text("commit_hash"),
  requestId: text("request_id"),
  maxTokensUsed: integer("max_tokens_used"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const versions = pgTable(
  "versions",
  {
    id: serial("id").primaryKey(),
    appId: integer("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    commitHash: text("commit_hash").notNull(),
    neonDbTimestamp: text("neon_db_timestamp"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("versions_app_commit_unique").on(table.appId, table.commitHash),
  ],
);

// Define relations (unchanged structure usually)
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

export const language_model_providers = pgTable("language_model_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  api_base_url: text("api_base_url").notNull(),
  env_var_name: text("env_var_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const language_models = pgTable("language_models", {
  id: serial("id").primaryKey(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations for new tables
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

// --- MCP tables ---
export const mcpServers = pgTable("mcp_servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  transport: text("transport").notNull(),
  command: text("command"),
  args: jsonb("args").$type<string[] | null>(),
  envJson: jsonb("env_json").$type<Record<string, string> | null>(),
  url: text("url"),
  enabled: boolean("enabled").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const mcpToolConsents = pgTable(
  "mcp_tool_consents",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    consent: text("consent").notNull().default("ask"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("uniq_mcp_consent").on(table.serverId, table.toolName)],
);

/**
 * Plugin System Types
 *
 * This module defines the core types for the Dyad plugin system.
 * Plugins provide external service integrations (e.g., Supabase, Neon, Vercel).
 */

import type { IpcMainInvokeEvent } from "electron";
import type { z } from "zod";

// ─────────────────────────────────────────────────────────────────────
// Plugin Metadata & Configuration
// ─────────────────────────────────────────────────────────────────────

/**
 * Unique identifier for a plugin.
 * Convention: lowercase, hyphenated (e.g., "supabase", "neon-postgres")
 */
export type PluginId = string;

/**
 * Plugin metadata for display and identification purposes.
 */
export interface PluginMetadata {
  /** Unique plugin identifier */
  id: PluginId;

  /** Human-readable display name */
  displayName: string;

  /** Short description of what the plugin provides */
  description: string;

  /** Plugin version (semver) */
  version: string;

  /** Plugin category for grouping in UI */
  category: PluginCategory;

  /** Icon identifier or path for UI */
  icon?: string;

  /** Documentation URL */
  docsUrl?: string;

  /** Whether this plugin is enabled by default */
  enabledByDefault?: boolean;
}

/**
 * Categories for organizing plugins in the UI.
 */
export type PluginCategory =
  | "database"
  | "authentication"
  | "hosting"
  | "storage"
  | "ai"
  | "monitoring"
  | "other";

// ─────────────────────────────────────────────────────────────────────
// Plugin Capabilities
// ─────────────────────────────────────────────────────────────────────

/**
 * Capabilities that a plugin can provide.
 * Each capability corresponds to a specific feature area.
 */
export interface PluginCapabilities {
  /** Plugin can provide OAuth-based authentication */
  oauth?: OAuthCapability;

  /** Plugin can provide database functionality */
  database?: DatabaseCapability;

  /** Plugin can provide serverless functions */
  functions?: FunctionsCapability;

  /** Plugin can provide AI/agent context */
  agentContext?: AgentContextCapability;

  /** Plugin can provide agent tools */
  agentTools?: AgentToolsCapability;

  /** Plugin provides system prompts for AI */
  prompts?: PromptsCapability;
}

/**
 * OAuth authentication capability.
 */
export interface OAuthCapability {
  /** OAuth authorization URL pattern */
  getAuthUrl: () => string;

  /** Handle OAuth callback/return */
  handleOAuthReturn: (params: OAuthReturnParams) => Promise<void>;

  /** Refresh access token */
  refreshToken: (params: RefreshTokenParams) => Promise<TokenResponse>;

  /** Check if the user is authenticated */
  isAuthenticated: () => boolean;

  /** List connected accounts/organizations */
  listAccounts: () => Promise<PluginAccount[]>;

  /** Disconnect an account */
  disconnectAccount: (accountId: string) => Promise<void>;
}

export interface OAuthReturnParams {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  accountId?: string;
  accountName?: string;
}

export interface RefreshTokenParams {
  accountId: string;
  refreshToken: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PluginAccount {
  id: string;
  name?: string;
  email?: string;
}

/**
 * Database capability for plugins that provide database services.
 */
export interface DatabaseCapability {
  /** Execute a SQL query */
  executeSql: (params: ExecuteSqlParams) => Promise<string>;

  /** Get database schema */
  getSchema: (params: GetSchemaParams) => Promise<DatabaseSchema>;

  /** List available projects/databases */
  listProjects: (accountId?: string) => Promise<DatabaseProject[]>;

  /** Link a project to an app */
  linkProject: (params: LinkProjectParams) => Promise<void>;

  /** Unlink a project from an app */
  unlinkProject: (appId: number) => Promise<void>;

  /** Get branches (if supported) */
  listBranches?: (params: ListBranchesParams) => Promise<DatabaseBranch[]>;
}

export interface ExecuteSqlParams {
  projectId: string;
  query: string;
  accountId?: string;
}

export interface GetSchemaParams {
  projectId: string;
  accountId?: string;
  tableName?: string;
}

export interface DatabaseSchema {
  tables: DatabaseTable[];
  functions?: DatabaseFunction[];
}

export interface DatabaseTable {
  name: string;
  columns: DatabaseColumn[];
  rlsEnabled?: boolean;
  policies?: DatabasePolicy[];
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
}

export interface DatabasePolicy {
  name: string;
  command: string;
  definition: string;
}

export interface DatabaseFunction {
  name: string;
  arguments: string;
  returnType: string;
  language: string;
  source?: string;
}

export interface DatabaseProject {
  id: string;
  name: string;
  region?: string;
  accountId: string;
}

export interface LinkProjectParams {
  appId: number;
  projectId: string;
  accountId: string;
  parentProjectId?: string;
}

export interface ListBranchesParams {
  projectId: string;
  accountId?: string;
}

export interface DatabaseBranch {
  id: string;
  name: string;
  isDefault: boolean;
  projectRef: string;
  parentProjectRef?: string;
}

/**
 * Serverless functions capability.
 */
export interface FunctionsCapability {
  /** Deploy a function */
  deployFunction: (params: DeployFunctionParams) => Promise<DeployedFunction>;

  /** Delete a function */
  deleteFunction: (params: DeleteFunctionParams) => Promise<void>;

  /** List deployed functions */
  listFunctions: (params: ListFunctionsParams) => Promise<DeployedFunction[]>;

  /** Get function logs */
  getLogs: (params: GetLogsParams) => Promise<FunctionLog[]>;
}

export interface DeployFunctionParams {
  projectId: string;
  functionName: string;
  appPath: string;
  accountId?: string;
  bundleOnly?: boolean;
}

export interface DeployedFunction {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "REMOVED" | "THROTTLED";
  version: number;
}

export interface DeleteFunctionParams {
  projectId: string;
  functionName: string;
  accountId?: string;
}

export interface ListFunctionsParams {
  projectId: string;
  accountId?: string;
}

export interface GetLogsParams {
  projectId: string;
  timestampStart?: number;
  accountId?: string;
}

export interface FunctionLog {
  timestamp: number;
  message: string;
  level: "info" | "warn" | "error";
  functionName?: string;
}

/**
 * Agent context capability - provides context to the AI agent.
 */
export interface AgentContextCapability {
  /** Get context string for the AI */
  getContext: (params: GetContextParams) => Promise<string>;

  /** Get lightweight project info */
  getProjectInfo: (params: GetProjectInfoParams) => Promise<string>;
}

export interface GetContextParams {
  projectId: string;
  accountId?: string;
}

export interface GetProjectInfoParams {
  projectId: string;
  accountId?: string;
  includeDbFunctions?: boolean;
}

/**
 * Agent tools capability - provides tools the AI agent can use.
 */
export interface AgentToolsCapability {
  /** Get tool definitions for the agent */
  getToolDefinitions: () => PluginToolDefinition[];
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  execute: (params: unknown) => Promise<unknown>;
  defaultConsent?: "ask" | "always" | "never";
}

/**
 * Prompts capability - provides system prompts for the AI.
 */
export interface PromptsCapability {
  /** Get system prompt content */
  getSystemPrompt: (params: GetPromptParams) => Promise<string>;
}

export interface GetPromptParams {
  projectId?: string;
  accountId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Plugin Lifecycle
// ─────────────────────────────────────────────────────────────────────

/**
 * Plugin lifecycle hooks.
 */
export interface PluginLifecycle {
  /** Called when the plugin is loaded */
  onLoad?: () => Promise<void>;

  /** Called when the plugin is unloaded */
  onUnload?: () => Promise<void>;

  /** Called when the app starts */
  onAppStart?: () => Promise<void>;

  /** Called when an app is selected */
  onAppSelected?: (appId: number) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// IPC Integration
// ─────────────────────────────────────────────────────────────────────

/**
 * IPC handler definition for a plugin.
 */
export interface PluginIpcHandler<TParams = unknown, TResult = unknown> {
  /** IPC channel name (will be prefixed with plugin id) */
  channel: string;

  /** Handler implementation */
  handler: (event: IpcMainInvokeEvent, params: TParams) => Promise<TResult>;

  /** Whether this handler is test-only */
  testOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Plugin Definition
// ─────────────────────────────────────────────────────────────────────

/**
 * Complete plugin definition.
 */
export interface PluginDefinition {
  /** Plugin metadata */
  metadata: PluginMetadata;

  /** Plugin capabilities */
  capabilities: PluginCapabilities;

  /** Plugin lifecycle hooks */
  lifecycle?: PluginLifecycle;

  /** Custom IPC handlers */
  ipcHandlers?: PluginIpcHandler[];

  /** Settings schema for this plugin (Zod schema) */
  settingsSchema?: z.ZodSchema;
}

// ─────────────────────────────────────────────────────────────────────
// App Integration Fields
// ─────────────────────────────────────────────────────────────────────

/**
 * Fields that a plugin can store on an app record.
 */
export interface PluginAppFields {
  /** The project/resource ID linked to the app */
  projectId?: string | null;

  /** Parent project ID (for branching scenarios) */
  parentProjectId?: string | null;

  /** Account/organization ID for credential lookup */
  accountId?: string | null;
}

/**
 * Generic app integration record.
 */
export interface AppIntegration {
  pluginId: PluginId;
  fields: PluginAppFields;
}

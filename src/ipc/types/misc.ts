import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";
import { ConsoleEntrySchema } from "./supabase";
import { ProblemReportSchema } from "./agent";

// =============================================================================
// Portal Schemas
// =============================================================================

export const PortalMigrateCreateParamsSchema = z.object({
  appId: z.number(),
});

export const PortalMigrateCreateResultSchema = z.object({
  output: z.string(),
});

// =============================================================================
// Env Vars Schemas
// =============================================================================

export const GetAppEnvVarsParamsSchema = z.object({
  appId: z.number(),
});

export const EnvVarSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export type EnvVar = z.infer<typeof EnvVarSchema>;

export const SetAppEnvVarsParamsSchema = z.object({
  appId: z.number(),
  envVars: z.array(EnvVarSchema),
});

// =============================================================================
// Session Debug Bundle Schemas
// =============================================================================

/**
 * Schema version for the session debug bundle format.
 * Bump this when making breaking changes to the schema.
 */
export const SESSION_DEBUG_SCHEMA_VERSION = 2;

// -- System info --

const DebugSystemInfoSchema = z.object({
  /** Coney application version (from package.json) */
  coneyVersion: z.string(),
  /** OS platform: "darwin", "win32", "linux" */
  platform: z.string(),
  /** CPU architecture: "x64", "arm64" */
  architecture: z.string(),
  /** Node.js version, or null if not found */
  nodeVersion: z.string().nullable(),
  /** pnpm version, or null if not found */
  pnpmVersion: z.string().nullable(),
  /** Resolved path to the node binary, or null */
  nodePath: z.string().nullable(),
  /** Electron version */
  electronVersion: z.string(),
  /** Telemetry ID for cross-referencing server-side logs. Null if user opted out. */
  telemetryId: z.string().nullable(),
});

// -- Non-sensitive settings snapshot --

const DebugSettingsSchema = z.object({
  /** Currently selected language model */
  selectedModel: z.object({
    name: z.string(),
    provider: z.string(),
    customModelId: z.number().optional(),
  }),
  /** Active chat mode for the session */
  selectedChatMode: z.string().nullable(),
  /** Default chat mode preference */
  defaultChatMode: z.string().nullable(),
  /** Whether changes are auto-approved without review */
  autoApproveChanges: z.boolean().nullable(),
  /** Whether Coney Pro is enabled */
  enableConeyPro: z.boolean().nullable(),
  /** Thinking budget level: "low" | "medium" | "high" */
  thinkingBudget: z.string().nullable(),
  /** Max chat turns kept in context window */
  maxChatTurnsInContext: z.number().nullable(),
  /** Whether auto-fix problems is enabled */
  enableAutoFixProblems: z.boolean().nullable(),
  /** Whether native git is enabled */
  enableNativeGit: z.boolean().nullable(),
  /** Whether auto-update is enabled */
  enableAutoUpdate: z.boolean(),
  /** Release channel: "stable" | "beta" */
  releaseChannel: z.string(),
  /** Runtime mode: "host" | "docker" */
  runtimeMode2: z.string().nullable(),
  /** UI zoom level */
  zoomLevel: z.string().nullable(),
  /** Preview device mode: "desktop" | "tablet" | "mobile" */
  previewDeviceMode: z.string().nullable(),
  /** Whether turbo edits mode is enabled */
  enableProLazyEditsMode: z.boolean().nullable(),
  /** Turbo edits mode variant: "off" | "v1" | "v2" */
  proLazyEditsMode: z.string().nullable(),
  /** Whether smart files context mode is enabled (Pro) */
  enableProSmartFilesContextMode: z.boolean().nullable(),
  /** Whether web search is enabled (Pro) */
  enableProWebSearch: z.boolean().nullable(),
  /** Smart context option: "balanced" | "conservative" | "deep" */
  proSmartContextOption: z.string().nullable(),
  /** Whether Supabase write SQL migration is enabled */
  enableSupabaseWriteSqlMigration: z.boolean().nullable(),
  /** Agent tool consent settings per tool */
  agentToolConsents: z.record(z.string(), z.string()).nullable(),
  /** Experiment flags */
  experiments: z.record(z.string(), z.boolean()).nullable(),
  /** Custom node path override */
  customNodePath: z.string().nullable(),
  /** Map of provider ID -> whether configured (has API key). No secrets. */
  providerSetupStatus: z.record(z.string(), z.boolean()),
});

// -- App metadata --

const DebugAppInfoSchema = z.object({
  id: z.number(),
  name: z.string(),
  /** Relative app path (not full filesystem path) */
  path: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Integration identifiers (non-secret)
  githubOrg: z.string().nullable(),
  githubRepo: z.string().nullable(),
  githubBranch: z.string().nullable(),
  supabaseProjectId: z.string().nullable(),
  supabaseOrganizationSlug: z.string().nullable(),
  neonProjectId: z.string().nullable(),
  vercelProjectId: z.string().nullable(),
  vercelProjectName: z.string().nullable(),
  vercelDeploymentUrl: z.string().nullable(),
  // Dev commands
  installCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
  // Chat context configuration
  chatContext: z.any().nullable(),
  // Theme
  themeId: z.string().nullable(),
});

// -- Message with full debug detail --

const DebugMessageSchema = z.object({
  id: z.number(),
  role: z.enum(["user", "assistant"]),
  /** Human-readable message text */
  content: z.string(),
  /** ISO 8601 timestamp */
  createdAt: z.string(),
  /**
   * Full AI SDK structured message data (tool calls, image refs, multi-turn state).
   * Base64 image data is stripped and replaced with:
   *   { type: "image", image: "[stripped]", mediaType: "...", _strippedByteLength: N }
   */
  aiMessagesJson: z.any().nullable(),
  /** Model name used to generate this response (assistant messages only) */
  model: z.string().nullable(),
  /** Total tokens used for this response (assistant messages only) */
  totalTokens: z.number().nullable(),
  /** Approval state: "approved" | "rejected" | null */
  approvalState: z.enum(["approved", "rejected"]).nullable(),
  /** Git commit hash of codebase when this message was created */
  sourceCommitHash: z.string().nullable(),
  /** Git commit hash of codebase after changes from this message were applied */
  commitHash: z.string().nullable(),
  /** Pro request UUID for billing/tracking */
  requestId: z.string().nullable(),
  /** Whether this message used the free agent mode quota */
  usingFreeAgentModeQuota: z.boolean().nullable(),
});

// -- Chat with messages --

const DebugChatSchema = z.object({
  id: z.number(),
  appId: z.number(),
  title: z.string().nullable(),
  /** Git commit hash at start of this chat */
  initialCommitHash: z.string().nullable(),
  /** ISO 8601 timestamp */
  createdAt: z.string(),
  messages: z.array(DebugMessageSchema),
});

// -- Provider / model configuration (no secrets) --

const DebugProvidersSchema = z.object({
  /** Custom provider definitions from language_model_providers table */
  customProviders: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hasApiBaseUrl: z.boolean(),
      envVarName: z.string().nullable(),
    }),
  ),
  /** Custom model definitions from language_models table */
  customModels: z.array(
    z.object({
      id: z.number(),
      displayName: z.string(),
      apiName: z.string(),
      builtinProviderId: z.string().nullable(),
      customProviderId: z.string().nullable(),
      maxOutputTokens: z.number().nullable(),
      contextWindow: z.number().nullable(),
    }),
  ),
});

// -- MCP server configuration (no env/header secrets) --

const DebugMcpServerSchema = z.object({
  id: z.number(),
  name: z.string(),
  transport: z.string(),
  command: z.string().nullable(),
  args: z.array(z.string()).nullable(),
  url: z.string().nullable(),
  enabled: z.boolean(),
  // NOTE: envJson and headersJson are intentionally EXCLUDED (may contain secrets)
});

// -- Top-level bundle --

/**
 * Complete session debug bundle for upload.
 *
 * Contains all non-sensitive data needed to debug a chat session:
 * system info, user settings, app config, full chat messages with
 * AI SDK JSON, provider/model setup, MCP servers, codebase snapshot,
 * and application logs.
 *
 * Sensitive data (API keys, OAuth tokens, MCP env vars) is stripped.
 * Base64 image data in AI SDK messages is replaced with placeholders.
 */
export const SessionDebugBundleSchema = z.object({
  /** Schema version number. Bump on breaking changes. */
  schemaVersion: z.number(),
  /** ISO 8601 timestamp of when this bundle was exported */
  exportedAt: z.string(),
  /** Runtime environment info */
  system: DebugSystemInfoSchema,
  /** Non-sensitive user settings snapshot */
  settings: DebugSettingsSchema,
  /** App configuration and integration metadata */
  app: DebugAppInfoSchema,
  /** Chat with full message history including AI SDK JSON */
  chat: DebugChatSchema,
  /** Custom provider and model definitions (no secrets) */
  providers: DebugProvidersSchema,
  /** MCP server configurations (no env/header secrets) */
  mcpServers: z.array(DebugMcpServerSchema),
  /** Formatted codebase snapshot */
  codebase: z.string(),
  /** Application logs (last 1000 lines) */
  logs: z.string(),
});

export type SessionDebugBundle = z.infer<typeof SessionDebugBundleSchema>;

// =============================================================================
// Deep Link Schemas
// =============================================================================

// Keep loose schema for IPC validation (accepts any deep link structure)
export const DeepLinkDataSchema = z.object({
  type: z.string(),
  payload: z.any().optional(),
});

// Re-export properly-typed discriminated union for TypeScript type narrowing
export type { DeepLinkData } from "../deep_link_data";

// =============================================================================
// App Output Schemas
// =============================================================================

export const AppOutputSchema = z.object({
  type: z.enum(["stdout", "stderr", "input-requested", "client-error", "info"]),
  message: z.string(),
  appId: z.number(),
  timestamp: z.number().optional(),
});

export type AppOutput = z.infer<typeof AppOutputSchema>;

// =============================================================================
// Misc Contracts
// =============================================================================

export const miscContracts = {
  // Portal
  portalMigrateCreate: defineContract({
    channel: "portal:migrate-create",
    input: PortalMigrateCreateParamsSchema,
    output: PortalMigrateCreateResultSchema,
  }),

  // Environment variables (global, not app-specific)
  getEnvVars: defineContract({
    channel: "get-env-vars",
    input: z.void(),
    output: z.record(z.string(), z.string().optional()),
  }),

  // App-specific env vars
  getAppEnvVars: defineContract({
    channel: "get-app-env-vars",
    input: GetAppEnvVarsParamsSchema,
    output: z.array(EnvVarSchema),
  }),

  setAppEnvVars: defineContract({
    channel: "set-app-env-vars",
    input: SetAppEnvVarsParamsSchema,
    output: z.void(),
  }),

  // Session debug bundle
  getSessionDebugBundle: defineContract({
    channel: "get-session-debug-bundle",
    input: z.number(), // chatId
    output: SessionDebugBundleSchema,
  }),

  // Console logs
  addLog: defineContract({
    channel: "add-log",
    input: ConsoleEntrySchema,
    output: z.void(),
  }),

  clearLogs: defineContract({
    channel: "clear-logs",
    input: z.object({ appId: z.number() }),
    output: z.void(),
  }),

  // Problems
  checkProblems: defineContract({
    channel: "check-problems",
    input: z.object({ appId: z.number() }),
    output: ProblemReportSchema,
  }),

  // Chat add dependency
  addDependency: defineContract({
    channel: "chat:add-dep",
    input: z.object({
      chatId: z.number(),
      packages: z.array(z.string()),
    }),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Misc Event Contracts
// =============================================================================

export const miscEvents = {
  appOutput: defineEvent({
    channel: "app:output",
    payload: AppOutputSchema,
  }),

  deepLinkReceived: defineEvent({
    channel: "deep-link-received",
    payload: DeepLinkDataSchema,
  }),

  chatStreamStart: defineEvent({
    channel: "chat:stream:start",
    payload: z.object({ chatId: z.number() }),
  }),

  chatStreamEnd: defineEvent({
    channel: "chat:stream:end",
    payload: z.object({ chatId: z.number() }),
  }),
} as const;

// =============================================================================
// Misc Clients
// =============================================================================

export const miscClient = createClient(miscContracts);
export const miscEventClient = createEventClient(miscEvents);

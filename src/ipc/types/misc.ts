import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";
import { ConsoleEntrySchema } from "./supabase";
import { ProblemReportSchema } from "./agent";
import { ChatStreamInvocationRefSchema } from "./chat";
import { AppRunInvocationRefSchema } from "./app";
import { PreviewAuthStatusSchema } from "../../app_run/transport";

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
export const SESSION_DEBUG_SCHEMA_VERSION = 4;

// -- System info --

const DebugSystemInfoSchema = z.object({
  /** Dyad application version (from package.json) */
  dyadVersion: z.string(),
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
  /** Whether Dyad Pro is enabled */
  enableDyadPro: z.boolean().nullable(),
  /** Model-specific effort level */
  effortLevel: z.string(),
  /** Max chat turns kept in context window */
  maxChatTurnsInContext: z.number().nullable(),
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

// -- Process memory diagnostics --

export const ProcessMetricSchema = z.object({
  pid: z.number(),
  rssKb: z.number(),
  command: z.string(),
});

export const ElectronProcessMetricSchema = z.object({
  type: z.string(),
  pid: z.number(),
  workingSetSizeKb: z.number(),
  creationTime: z.number(),
  name: z.string().optional(),
  serviceName: z.string().optional(),
});

export const ElectronProcessMetricsResultSchema = z.object({
  processes: z.array(ElectronProcessMetricSchema),
  totalWorkingSetSizeMb: z.number(),
  mainProcess: z.object({
    rssMb: z.number(),
    heapTotalMb: z.number(),
    heapUsedMb: z.number(),
    externalMb: z.number(),
  }),
  v8Heap: z.object({
    heapSizeLimitMb: z.number(),
    totalHeapSizeMb: z.number(),
    usedHeapSizeMb: z.number(),
    mallocedMemoryMb: z.number(),
    externalMemoryMb: z.number(),
  }),
  error: z.string().optional(),
});

export const AppProcessTreeSchema = z.object({
  appId: z.number(),
  rootPid: z.number(),
  processes: z.array(ProcessMetricSchema),
  totalRssMb: z.number(),
  note: z.string().optional(),
});

export const AppProcessTreesResultSchema = z.object({
  supported: z.boolean(),
  trees: z.array(AppProcessTreeSchema),
  error: z.string().optional(),
});

export const VmStatSummarySchema = z.object({
  pageSizeBytes: z.number(),
  freePages: z.number(),
  activePages: z.number(),
  inactivePages: z.number(),
  speculativePages: z.number(),
  wiredPages: z.number(),
  purgeablePages: z.number(),
  compressorPages: z.number(),
  pageouts: z.number(),
});

export const SystemMemorySignalsSchema = z.object({
  platform: z.string(),
  totalMemoryMb: z.number(),
  appMemoryMb: z.number().optional(),
  reclaimableMb: z.number().optional(),
  freeMb: z.number().optional(),
  swapUsedMb: z.number().optional(),
  swapTotalMb: z.number().optional(),
  pressureDetected: z.boolean().optional(),
  vmStat: VmStatSummarySchema.optional(),
  fallback: z
    .object({
      usedMemoryMb: z.number(),
      freeMemoryMb: z.number(),
      usagePercent: z.number(),
    })
    .optional(),
  error: z.string().optional(),
});

export const TopProcessesResultSchema = z.object({
  captured: z.boolean(),
  reason: z.string(),
  processes: z.array(ProcessMetricSchema).optional(),
  error: z.string().optional(),
});

export const ProcessMemoryDiagnosticsSchema = z.object({
  collectedAt: z.string(),
  platform: z.string(),
  electron: ElectronProcessMetricsResultSchema,
  appProcessTrees: AppProcessTreesResultSchema,
  systemMemory: SystemMemorySignalsSchema,
  topProcesses: TopProcessesResultSchema,
});

export type ProcessMetric = z.infer<typeof ProcessMetricSchema>;
export type ElectronProcessMetric = z.infer<typeof ElectronProcessMetricSchema>;
export type ElectronProcessMetricsResult = z.infer<
  typeof ElectronProcessMetricsResultSchema
>;
export type AppProcessTree = z.infer<typeof AppProcessTreeSchema>;
export type AppProcessTreesResult = z.infer<typeof AppProcessTreesResultSchema>;
export type VmStatSummary = z.infer<typeof VmStatSummarySchema>;
export type SystemMemorySignals = z.infer<typeof SystemMemorySignalsSchema>;
export type TopProcessesResult = z.infer<typeof TopProcessesResultSchema>;
export type ProcessMemoryDiagnostics = z.infer<
  typeof ProcessMemoryDiagnosticsSchema
>;

// -- Native crash dumps --

/**
 * One candidate frame: an offset into `modules[module]`, or "unknown" when a
 * thread's instruction pointer fell outside every module (e.g. JIT code).
 * Frames after the first come from scanning the stack for values that point
 * into code, so some are stale return addresses or function pointers held in
 * locals rather than real calls. Resolve them against symbols with
 * `node scripts/resolve-crash-frames.mjs --bundle <file.json>`, which also
 * drops the values that are not return addresses.
 */
const CrashStackFrameSchema = z.union([
  z.object({ module: z.number(), offset: z.string() }),
  z.literal("unknown"),
]);

const CrashStackSchema = z.object({
  /** Modules the frames reference, by index. */
  modules: z.array(
    z.object({
      /** Basename with control characters removed, capped at 128 characters. */
      name: z.string(),
      /** With debugId, keys the module's symbol file (e.g. on symbols.electronjs.org). */
      debugFile: z.string(),
      /** Breakpad debug id. Absent when the module has no CodeView record. */
      debugId: z.string().optional(),
    }),
  ),
  /** The crashing thread first, then the main thread if another one crashed. */
  threads: z.array(
    z.object({
      crashing: z.boolean(),
      /** The process's first thread: the UI thread, for the browser process. */
      main: z.boolean(),
      /** Instruction pointer first, then stack order (callers last). */
      frames: z.array(CrashStackFrameSchema),
    }),
  ),
});

/**
 * A native crash dump kept on the reporter's machine, reduced to what a stack
 * trace needs. No stack memory, absolute address, or file path is included.
 */
const CrashDumpSchema = z.object({
  /** Retained file name, e.g. crash-2026-06-07T20-41-55-123Z-9ac4d4e8.dmp */
  file: z.string(),
  /** ISO 8601 time of the crash (the dump's modification time). */
  crashedAt: z.string(),
  /** False when the file could not be parsed as a minidump; nothing else is set then. */
  readable: z.boolean(),
  /** Crashing process type: "browser" (main), "renderer", "gpu-process", "utility", ... */
  ptype: z.string().optional(),
  /** Signal, Mach exception, or NTSTATUS name, e.g. "SIGSEGV". */
  crashReason: z.string().optional(),
  exceptionCode: z.number().optional(),
  /** Exact only near null; "non-null" otherwise. */
  faultAddress: z.string().optional(),
  accessType: z.enum(["read", "write", "execute"]).optional(),
  inPageErrorStatus: z.string().optional(),
  oomAllocationSizeBytes: z.number().optional(),
  fastFailCode: z.number().optional(),
  /** Crashpad annotations, limited to the keys crash telemetry keeps (app version, V8 heap, ...). */
  annotations: z.record(z.string(), z.string()).optional(),
  stack: CrashStackSchema.optional(),
});

export const CrashDumpsSchema = z.object({
  /** Every dump kept on the machine (up to 5), newest first. */
  dumps: z.array(CrashDumpSchema),
  /**
   * Set only on a report started from the crash dialog: the `file` of the
   * dump the crash left, or null when no readable dump was tied to it (a
   * force kill, the OOM killer, power loss, or a dump too damaged to read,
   * which is still listed in `dumps`). The named dump may have been pruned since. A dump
   * labelled "browser" is certain; one with no process label is matched only
   * because the app did not quit cleanly, as with a main-process V8 OOM,
   * and could instead be a child that ran out of memory.
   */
  triggeringDump: z.string().nullable().optional(),
});

export type CrashDump = z.infer<typeof CrashDumpSchema>;
export type CrashDumps = z.infer<typeof CrashDumpsSchema>;

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
  /** Auto-updater failure details (last in-process error + Squirrel log tail on Windows). Null if none. */
  updaterLogs: z.string().nullable(),
  /**
   * Process-level memory diagnostics: Electron process metrics, per-app child
   * process tree RSS, and real system memory-pressure signals (darwin).
   * Best-effort — sections may carry an `error` field instead of data. The
   * shape is owned by src/utils/process_memory_diagnostics.ts. Each section
   * can carry an error field so diagnostics failures never break the export.
   */
  memoryDiagnostics: ProcessMemoryDiagnosticsSchema.nullable(),
  /**
   * Stack traces from the native crash dumps kept on the machine. Absent when
   * the reporter unticked them, and in bundles from older versions.
   */
  crashDumps: CrashDumpsSchema.optional(),
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
  previewAuth: PreviewAuthStatusSchema.optional(),
  type: z.enum([
    "stdout",
    "stderr",
    "input-requested",
    "client-error",
    "info",
    "package-manager-warning",
    "sync-error",
    "sync-recovered",
    "app-exit",
    "agent-lifecycle-started",
    "agent-lifecycle-succeeded",
    "agent-lifecycle-failed",
  ]),
  message: z.string(),
  appId: z.number(),
  /** Correlation identity of the process/lifecycle producer when available. */
  invocationRef: AppRunInvocationRefSchema.optional(),
  warningKind: z.enum(["release-age", "pnpm-migration"]).optional(),
  timestamp: z.number().optional(),
  exitCode: z.number().nullable().optional(),
  signal: z.string().nullable().optional(),
  lifecycleRequestId: z.string().optional(),
  lifecycleOperation: z.enum(["restart", "rebuild"]).optional(),
  lifecycleRuntimeMayBeLive: z.boolean().optional(),
  runtimeBoundary: z.enum(["start", "restart", "rebuild"]).optional(),
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
    input: z.object({
      chatId: z.number(),
      /** The report was started from the crash dialog. */
      fromCrash: z.boolean(),
    }),
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

  rendererErrorToastReady: defineContract({
    channel: "renderer:error-toast-ready",
    input: z.void(),
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

  appOutputBatch: defineEvent({
    channel: "app:output-batch",
    payload: z.array(AppOutputSchema),
  }),

  deepLinkReceived: defineEvent({
    channel: "deep-link-received",
    payload: DeepLinkDataSchema,
  }),

  chatStreamStart: defineEvent({
    channel: "chat:stream:start",
    payload: z.object({
      chatId: z.number(),
      invocationRef: ChatStreamInvocationRefSchema.optional(),
      streamId: z.number().optional(),
    }),
  }),

  chatStreamEnd: defineEvent({
    channel: "chat:stream:end",
    payload: z.object({ chatId: z.number() }),
  }),

  errorToast: defineEvent({
    channel: "toast:error",
    payload: z.object({
      message: z.string(),
      persist: z.boolean().optional(),
      toastId: z.string().optional(),
      action: z
        .object({
          label: z.string(),
          url: z.string(),
        })
        .optional(),
    }),
  }),

  dismissToast: defineEvent({
    channel: "toast:dismiss",
    payload: z.object({ toastId: z.string() }),
  }),
} as const;

// =============================================================================
// Misc Clients
// =============================================================================

export const miscClient = createClient(miscContracts);
export const miscEventClient = createEventClient(miscEvents);

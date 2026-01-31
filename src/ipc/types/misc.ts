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
// Chat Logs Schemas
// =============================================================================

export const ChatLogsDataSchema = z.object({
  debugInfo: z.object({
    nodeVersion: z.string().nullable(),
    pnpmVersion: z.string().nullable(),
    nodePath: z.string().nullable(),
    telemetryId: z.string(),
    telemetryConsent: z.string(),
    telemetryUrl: z.string(),
    dyadVersion: z.string(),
    platform: z.string(),
    architecture: z.string(),
    logs: z.string(),
    selectedLanguageModel: z.string(),
  }),
  chat: z.object({
    id: z.number(),
    title: z.string(),
    messages: z.array(
      z.object({
        id: z.number(),
        role: z.string(),
        content: z.string(),
        approvalState: z.string().nullable().optional(),
      }),
    ),
  }),
  codebase: z.string(),
});

export type ChatLogsData = z.infer<typeof ChatLogsDataSchema>;

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

  // Chat logs
  getChatLogs: defineContract({
    channel: "get-chat-logs",
    input: z.number(), // chatId
    output: ChatLogsDataSchema,
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

import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

// =============================================================================
// System Schemas
// =============================================================================

export const NodeSystemInfoSchema = z.object({
  nodeVersion: z.string().nullable(),
  pnpmVersion: z.string().nullable(),
  nodeDownloadUrl: z.string(),
});

export type NodeSystemInfo = z.infer<typeof NodeSystemInfoSchema>;

export const SystemDebugInfoSchema = z.object({
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
});

export type SystemDebugInfo = z.infer<typeof SystemDebugInfoSchema>;

export const SelectNodeFolderResultSchema = z.object({
  path: z.string().nullable(),
  canceled: z.boolean(),
  selectedPath: z.string().nullable(),
});

export type SelectNodeFolderResult = z.infer<
  typeof SelectNodeFolderResultSchema
>;

export const SelectAppFolderResultSchema = z.object({
  path: z.string().nullable(),
  name: z.string().nullable(),
});

export const SelectAppLocationResultSchema = z.object({
  path: z.string().nullable(),
  canceled: z.boolean(),
});

export const DoesReleaseNoteExistParamsSchema = z.object({
  version: z.string(),
});

export type DoesReleaseNoteExistParams = z.infer<
  typeof DoesReleaseNoteExistParamsSchema
>;

export const DoesReleaseNoteExistResultSchema = z.object({
  exists: z.boolean(),
  url: z.string().optional(),
});

export const UserBudgetInfoSchema = z
  .object({
    usedCredits: z.number(),
    totalCredits: z.number(),
    budgetResetDate: z.date(),
    redactedUserId: z.string(),
    isTrial: z.boolean(),
  })
  .nullable();

export type UserBudgetInfo = z.infer<typeof UserBudgetInfoSchema>;

export const TelemetryEventPayloadSchema = z.object({
  eventName: z.string(),
  properties: z.record(z.string(), z.any()).optional(),
});

export type TelemetryEventPayload = z.infer<typeof TelemetryEventPayloadSchema>;

export const ForceCloseDetectedPayloadSchema = z.object({
  performanceData: z
    .object({
      timestamp: z.number(),
      memoryUsageMB: z.number(),
      cpuUsagePercent: z.number().optional(),
      systemMemoryUsageMB: z.number().optional(),
      systemMemoryTotalMB: z.number().optional(),
      systemCpuPercent: z.number().optional(),
    })
    .optional(),
});

// =============================================================================
// System Contracts
// =============================================================================

export const systemContracts = {
  // Window controls
  minimizeWindow: defineContract({
    channel: "window:minimize",
    input: z.void(),
    output: z.void(),
  }),

  maximizeWindow: defineContract({
    channel: "window:maximize",
    input: z.void(),
    output: z.void(),
  }),

  closeWindow: defineContract({
    channel: "window:close",
    input: z.void(),
    output: z.void(),
  }),

  // Platform info
  getSystemPlatform: defineContract({
    channel: "get-system-platform",
    input: z.void(),
    output: z.string(),
  }),

  getSystemDebugInfo: defineContract({
    channel: "get-system-debug-info",
    input: z.void(),
    output: SystemDebugInfoSchema,
  }),

  getAppVersion: defineContract({
    channel: "get-app-version",
    input: z.void(),
    output: z.object({ version: z.string() }),
  }),

  // Node.js
  getNodejsStatus: defineContract({
    channel: "nodejs-status",
    input: z.void(),
    output: NodeSystemInfoSchema,
  }),

  selectNodeFolder: defineContract({
    channel: "select-node-folder",
    input: z.void(),
    output: SelectNodeFolderResultSchema,
  }),

  getNodePath: defineContract({
    channel: "get-node-path",
    input: z.void(),
    output: z.string().nullable(),
  }),

  // File/folder selection
  selectAppFolder: defineContract({
    channel: "select-app-folder",
    input: z.void(),
    output: SelectAppFolderResultSchema,
  }),

  // External
  openExternalUrl: defineContract({
    channel: "open-external-url",
    input: z.string(),
    output: z.void(),
  }),

  showItemInFolder: defineContract({
    channel: "show-item-in-folder",
    input: z.string(),
    output: z.void(),
  }),

  // Session
  clearSessionData: defineContract({
    channel: "clear-session-data",
    input: z.void(),
    output: z.void(),
  }),

  resetAll: defineContract({
    channel: "reset-all",
    input: z.void(),
    output: z.void(),
  }),

  reloadEnvPath: defineContract({
    channel: "reload-env-path",
    input: z.void(),
    output: z.void(),
  }),

  // Release notes
  doesReleaseNoteExist: defineContract({
    channel: "does-release-note-exist",
    input: DoesReleaseNoteExistParamsSchema,
    output: DoesReleaseNoteExistResultSchema,
  }),

  // Budget
  getUserBudget: defineContract({
    channel: "get-user-budget",
    input: z.void(),
    output: UserBudgetInfoSchema,
  }),

  // Upload
  uploadToSignedUrl: defineContract({
    channel: "upload-to-signed-url",
    input: z.object({
      url: z.string(),
      contentType: z.string(),
      data: z.any(),
    }),
    output: z.void(),
  }),

  // Screenshot
  takeScreenshot: defineContract({
    channel: "take-screenshot",
    input: z.void(),
    output: z.void(),
  }),

  // Restart
  restartDyad: defineContract({
    channel: "restart-dyad",
    input: z.void(),
    output: z.void(),
  }),
} as const;

// =============================================================================
// System Event Contracts
// =============================================================================

export const systemEvents = {
  telemetryEvent: defineEvent({
    channel: "telemetry:event",
    payload: TelemetryEventPayloadSchema,
  }),

  forceCloseDetected: defineEvent({
    channel: "force-close-detected",
    payload: ForceCloseDetectedPayloadSchema,
  }),
} as const;

// =============================================================================
// System Client
// =============================================================================

export const systemClient = createClient(systemContracts);
export const systemEventClient = createEventClient(systemEvents);

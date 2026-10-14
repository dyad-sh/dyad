import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Isolated chat workspace schemas
// =============================================================================

export const WorkspaceIntegrationPhaseSchema = z.enum([
  "idle",
  "queued",
  "merging",
  "resolving-conflicts",
  "validating",
  "integrating",
  "merged",
  "paused",
  "failed",
]);
export type WorkspaceIntegrationPhase = z.infer<
  typeof WorkspaceIntegrationPhaseSchema
>;

export const WorkspaceValidationCheckSchema = z.object({
  name: z.enum(["install", "type-check", "build", "test"]),
  outcome: z.enum(["passed", "failed", "missing", "skipped"]),
  summary: z.string(),
  output: z.string().optional(),
});
export type WorkspaceValidationCheckDto = z.infer<
  typeof WorkspaceValidationCheckSchema
>;

export const ChatWorkspaceStatusSchema = z.object({
  chatId: z.number(),
  appId: z.number(),
  /** Where the chat's writable turns run. */
  kind: z.enum(["original", "isolated"]),
  /**
   * Branch to show: the workspace branch, or the original folder's current
   * branch (null when it is showing an earlier version).
   */
  branch: z.string().nullable(),
  /** Branch an isolated workspace merges into. */
  targetBranch: z.string().nullable(),
  workspaceId: z.number().nullable(),
  /** Runtime id the preview for this chat uses. */
  runtimeAppId: z.number(),
  /** Whether a writable turn of this chat is running right now. */
  writableTurnRunning: z.boolean(),
  integration: z
    .object({
      phase: WorkspaceIntegrationPhaseSchema,
      detail: z.string().nullable(),
      validation: z.array(WorkspaceValidationCheckSchema).nullable(),
      canRetry: z.boolean(),
    })
    .nullable(),
});
export type ChatWorkspaceStatus = z.infer<typeof ChatWorkspaceStatusSchema>;

export const AppWorkspaceOverviewSchema = z.object({
  appId: z.number(),
  isolationEnabled: z.boolean(),
  /** Chats with a writable turn running right now. */
  writableChatIds: z.array(z.number()),
  workspaces: z.array(
    z.object({
      chatId: z.number(),
      workspaceId: z.number(),
      branch: z.string(),
      phase: WorkspaceIntegrationPhaseSchema,
    }),
  ),
});
export type AppWorkspaceOverview = z.infer<typeof AppWorkspaceOverviewSchema>;

// =============================================================================
// Contracts
// =============================================================================

export const workspaceContracts = {
  getChatWorkspaceStatus: defineContract({
    channel: "workspace:get-chat-status",
    input: z.object({ chatId: z.number().int().positive() }),
    output: ChatWorkspaceStatusSchema,
  }),

  getAppWorkspaceOverview: defineContract({
    channel: "workspace:get-app-overview",
    input: z.object({ appId: z.number().int().positive() }),
    output: AppWorkspaceOverviewSchema,
  }),

  retryIntegration: defineContract({
    channel: "workspace:retry-integration",
    input: z.object({ chatId: z.number().int().positive() }),
    output: z.void(),
  }),

  /**
   * Undo for a chat in an isolated workspace: reverts only the chat's own
   * commits from `fromUserMessageId` onward and removes those messages.
   */
  undoTurns: defineContract({
    channel: "workspace:undo-turns",
    input: z.object({
      chatId: z.number().int().positive(),
      fromUserMessageId: z.number().int().positive(),
    }),
    output: z.object({ undoCommit: z.string().nullable() }),
  }),
} as const;

export const workspaceClient = createClient(workspaceContracts);

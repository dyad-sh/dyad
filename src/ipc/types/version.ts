import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Version Schemas
// =============================================================================

export const VersionSchema = z.object({
  oid: z.string(), // commit hash
  message: z.string(),
  timestamp: z.number(),
  dbTimestamp: z.string().nullable().optional(),
});

export type Version = z.infer<typeof VersionSchema>;

export const BranchResultSchema = z.object({
  branch: z.string(),
});

export type BranchResult = z.infer<typeof BranchResultSchema>;

export const CurrentChatMessageIdSchema = z.object({
  chatId: z.number(),
  messageId: z.number(),
});

export const RevertVersionParamsSchema = z.object({
  appId: z.number(),
  previousVersionId: z.string(),
  currentChatMessageId: CurrentChatMessageIdSchema.optional(),
});

export type RevertVersionParams = z.infer<typeof RevertVersionParamsSchema>;

export const RevertVersionResponseSchema = z.union([
  z.object({ successMessage: z.string() }),
  z.object({ warningMessage: z.string() }),
]);

export type RevertVersionResponse = z.infer<typeof RevertVersionResponseSchema>;

export const CheckoutVersionParamsSchema = z.object({
  appId: z.number(),
  versionId: z.string(),
});

export const RestoreToMessageParamsSchema = z.object({
  appId: z.number(),
  chatId: z.number(),
  messageId: z.number(),
});

export type RestoreToMessageParams = z.infer<
  typeof RestoreToMessageParamsSchema
>;

export const RestoreToMessageResponseSchema = z.union([
  z.object({ newChatId: z.number(), successMessage: z.string() }),
  z.object({ newChatId: z.number(), warningMessage: z.string() }),
  // No version could be determined, so no new chat was created. The renderer
  // should stay on the current chat (there is no `newChatId` to navigate to).
  z.object({ warningMessage: z.string() }),
]);

export type RestoreToMessageResponse = z.infer<
  typeof RestoreToMessageResponseSchema
>;

// =============================================================================
// Version Contracts
// =============================================================================

export const versionContracts = {
  listVersions: defineContract({
    channel: "list-versions",
    input: z.object({ appId: z.number() }),
    output: z.array(VersionSchema),
  }),

  revertVersion: defineContract({
    channel: "revert-version",
    input: RevertVersionParamsSchema,
    output: RevertVersionResponseSchema,
  }),

  checkoutVersion: defineContract({
    channel: "checkout-version",
    input: CheckoutVersionParamsSchema,
    output: z.void(),
  }),

  restoreToMessageVersion: defineContract({
    channel: "restore-to-message-version",
    input: RestoreToMessageParamsSchema,
    output: RestoreToMessageResponseSchema,
  }),

  getCurrentBranch: defineContract({
    channel: "get-current-branch",
    input: z.object({ appId: z.number() }),
    output: BranchResultSchema,
  }),
} as const;

// =============================================================================
// Version Client
// =============================================================================

export const versionClient = createClient(versionContracts);

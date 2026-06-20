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
  isFavorite: z.boolean(),
  note: z.string().nullable(),
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

export const UncommittedChangesStrategySchema = z.enum(["commit", "discard"]);

export type UncommittedChangesStrategy = z.infer<
  typeof UncommittedChangesStrategySchema
>;

export const RevertVersionParamsSchema = z.object({
  appId: z.number(),
  previousVersionId: z.string(),
  currentChatMessageId: CurrentChatMessageIdSchema.optional(),
  // How to resolve uncommitted changes on `main` before reverting. When omitted
  // and the worktree is dirty, the revert is refused as a backstop; the UI
  // resolves this first via UncommittedChangesGateDialog and passes the choice.
  uncommittedChangesStrategy: UncommittedChangesStrategySchema.optional(),
  // Commit message to use when uncommittedChangesStrategy is "commit".
  commitMessage: z.string().optional(),
});

export type RevertVersionParams = z.infer<typeof RevertVersionParamsSchema>;

export const RevertVersionResponseSchema = z.union([
  z.object({ successMessage: z.string() }),
  z.object({ warningMessage: z.string() }),
]);

export type RevertVersionResponse = z.infer<typeof RevertVersionResponseSchema>;

export const CheckoutVersionParamsSchema = z.object({
  appId: z.number(),
  // Unlike getVersionChanges, this accepts arbitrary git refs (e.g. the "main"
  // branch for the restore-to-latest flow), so it can't be constrained to a hex
  // SHA. We still reject leading-dash values so a ref can't be interpreted as a
  // git option when passed to native `git checkout`.
  versionId: z
    .string()
    .refine((v) => !v.startsWith("-"), "versionId must not start with '-'"),
});

export const VersionChangeTypeSchema = z.enum(["added", "modified", "deleted"]);

export const VersionChangedFileSchema = z.object({
  path: z.string(),
  type: VersionChangeTypeSchema,
  oldContent: z.string(), // "" when added (or old side absent/binary)
  newContent: z.string(), // "" when deleted (or new side absent/binary)
});

export type VersionChangedFile = z.infer<typeof VersionChangedFileSchema>;

export const GetVersionChangesParamsSchema = z.object({
  appId: z.number(),
  // Must be a hex commit SHA. This is appended as a positional argument to
  // native `git diff-tree`/`cat-file`; constraining it to hex characters
  // prevents a dash-prefixed value from being interpreted as a git option.
  versionId: z
    .string()
    .regex(/^[0-9a-fA-F]{4,64}$/, "versionId must be a hex commit SHA"),
});

export const CheckoutVersionResponseSchema = z.object({
  warningMessage: z.string().optional(),
});

export type CheckoutVersionResponse = z.infer<
  typeof CheckoutVersionResponseSchema
>;

const CommitHashSchema = z
  .string()
  .regex(/^[a-f0-9]{40,64}$/i, "versionId must be a full hex commit SHA");
export const MAX_VERSION_NOTE_LENGTH = 10_000;

export const SetVersionFavoriteParamsSchema = z.object({
  appId: z.number(),
  versionId: CommitHashSchema,
  isFavorite: z.boolean(),
});

export const SetVersionNoteParamsSchema = z.object({
  appId: z.number(),
  versionId: CommitHashSchema,
  note: z.string().max(MAX_VERSION_NOTE_LENGTH).nullable(),
});

export const VersionMetadataResultSchema = z.object({
  oid: z.string(),
  isFavorite: z.boolean(),
  note: z.string().nullable(),
});

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
    output: CheckoutVersionResponseSchema,
  }),

  getVersionChanges: defineContract({
    channel: "get-version-changes",
    input: GetVersionChangesParamsSchema,
    output: z.array(VersionChangedFileSchema),
  }),

  setVersionFavorite: defineContract({
    channel: "set-version-favorite",
    input: SetVersionFavoriteParamsSchema,
    output: VersionMetadataResultSchema,
  }),

  setVersionNote: defineContract({
    channel: "set-version-note",
    input: SetVersionNoteParamsSchema,
    output: VersionMetadataResultSchema,
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

import { z } from "zod";
import {
  defineContract,
  createClient,
  createEventClient,
  defineEvent,
} from "../contracts/core";
import { SafeGitRefSchema } from "../../shared/git_refs";

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

export const RevertVersionParamsSchema = z.object({
  appId: z.number(),
  previousVersionId: z.string(),
  expectedHeadOid: z.string().optional(),
  currentChatMessageId: CurrentChatMessageIdSchema.optional(),
  targetBranchName: z
    .string()
    .refine(
      (v) => !v.startsWith("-"),
      "targetBranchName must not start with '-'",
    )
    .optional(),
});

export type RevertVersionParams = z.infer<typeof RevertVersionParamsSchema>;

export const VersionCommandResultSchema = z.object({
  repositoryOutcome: z.enum(["target-applied", "unchanged"]),
  notification: z
    .object({
      kind: z.enum(["success", "warning"]),
      message: z.string(),
    })
    .nullable(),
  runtimeAction: z.enum(["none", "restart"]),
  affectedChatId: z.number().nullable(),
  createdChatId: z.number().nullable(),
});

export type VersionCommandResult = z.infer<typeof VersionCommandResultSchema>;
export type RevertVersionResponse = VersionCommandResult;

export const CheckoutVersionParamsSchema = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("preview"),
    appId: z.number(),
    versionId: SafeGitRefSchema,
  }),
  z.object({
    purpose: z.literal("return"),
    appId: z.number(),
    branch: SafeGitRefSchema,
  }),
]);

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

export const CheckoutVersionResponseSchema = VersionCommandResultSchema;
export type CheckoutVersionResponse = VersionCommandResult;

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

export const RestoreToMessageParamsSchema = z.object({
  // Constrain to positive integers: these are autoIncrement primary keys, so
  // negative, zero, and float values are always invalid and should fail fast
  // with a descriptive error rather than silently matching no row.
  appId: z.number().int().positive(),
  chatId: z.number().int().positive(),
  messageId: z.number().int().positive(),
  // When true (the default), the codebase (and database, if applicable) is
  // reverted to the version before this message in addition to forking the
  // chat. When false, only the chat is forked and the codebase is left as-is.
  restoreCodebase: z.boolean().optional(),
  // When invoked while the Version pane is previewing a historical commit,
  // HEAD is detached. The renderer passes the branch it will return to so
  // fork-only chats can be anchored to the live branch instead of the preview.
  targetBranchName: z
    .string()
    .refine(
      (v) => !v.startsWith("-"),
      "targetBranchName must not start with '-'",
    )
    .optional(),
});

export type RestoreToMessageParams = z.infer<
  typeof RestoreToMessageParamsSchema
>;

export const RestoreToMessageResponseSchema = VersionCommandResultSchema;

export type RestoreToMessageResponse = z.infer<
  typeof RestoreToMessageResponseSchema
>;

export const VersionPreviewPresentationResultSchema = z
  .object({
    operationId: z.string(),
    appId: z.number().int().positive(),
    notification: z
      .object({
        kind: z.enum(["success", "warning", "error"]),
        message: z.string(),
      })
      .nullable(),
    affectedChatId: z.number().int().positive().nullable(),
    createdChatId: z.number().int().positive().nullable(),
  })
  .strict();

// =============================================================================
// Version Contracts
// =============================================================================

export const versionContracts = {
  acquirePreviewWindowInterest: defineContract({
    channel: "version-preview:acquire-window-interest",
    input: z.object({ appId: z.number().int().positive() }).strict(),
    output: z.object({ acquired: z.boolean() }).strict(),
  }),

  restorePreviewWindowInterest: defineContract({
    channel: "version-preview:restore-window-interest",
    input: z.object({ appId: z.number().int().positive() }).strict(),
    output: z.object({ acquired: z.boolean() }).strict(),
  }),

  releasePreviewWindowInterest: defineContract({
    channel: "version-preview:release-window-interest",
    input: z
      .object({
        appId: z.number().int().positive(),
        operationId: z.string().min(1),
        exit: z.discriminatedUnion("type", [
          z.object({ type: z.literal("close") }).strict(),
          z
            .object({
              type: z.literal("switch-app"),
              nextAppId: z.number().int().positive().nullable(),
            })
            .strict(),
        ]),
      })
      .strict(),
    output: z.object({ cleanupStarted: z.boolean() }).strict(),
  }),

  listVersions: defineContract({
    channel: "list-versions",
    input: z.object({ appId: z.number(), ref: SafeGitRefSchema.optional() }),
    output: z.array(VersionSchema),
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
    invalidates: (input) => [{ family: "versions", appId: input.appId }],
  }),

  setVersionNote: defineContract({
    channel: "set-version-note",
    input: SetVersionNoteParamsSchema,
    output: VersionMetadataResultSchema,
    invalidates: (input) => [{ family: "versions", appId: input.appId }],
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

export const versionEvents = {
  previewResult: defineEvent({
    channel: "version-preview:result",
    payload: VersionPreviewPresentationResultSchema,
  }),
} as const;

export const versionEventClient = createEventClient(versionEvents);

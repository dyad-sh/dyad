import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Version Schemas
// =============================================================================

export const VersionSchema = z.object({
  oid: z.string(), // commit hash
  message: z.string(),
  messageTruncated: z.boolean().optional(),
  timestamp: z.number(),
  dbTimestamp: z.string().nullable().optional(),
  isFavorite: z.boolean(),
  note: z.string().nullable(),
});

export type Version = z.infer<typeof VersionSchema>;

export const DEFAULT_VERSION_PAGE_SIZE = 100;
export const MAX_VERSION_PAGE_SIZE = 200;
export const MAX_VERSION_CURSOR_OFFSET = 100_000;
export const MAX_VERSION_COMMIT_MESSAGE_BYTES = 4_096;
export const MAX_VERSION_CHANGED_FILES = 1_000;
export const MAX_VERSION_CHANGED_PATH_BYTES = 256 * 1_024;
export const MAX_VERSION_DIFF_CONTENT_BYTES = 1_000_000;

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
  targetBranchName: z
    .string()
    .refine(
      (v) => !v.startsWith("-"),
      "targetBranchName must not start with '-'",
    )
    .optional(),
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
});

export type VersionChangedFile = z.infer<typeof VersionChangedFileSchema>;

export const VersionChangesResultSchema = z.object({
  files: z.array(VersionChangedFileSchema),
  truncated: z.boolean(),
});

export type VersionChangesResult = z.infer<typeof VersionChangesResultSchema>;

export const VersionDiffContentStatusSchema = z.enum([
  "available",
  "missing",
  "binary",
  "too-large",
]);

export const VersionFileChangeSchema = VersionChangedFileSchema.extend({
  oldContent: z.string(),
  newContent: z.string(),
  oldContentStatus: VersionDiffContentStatusSchema,
  newContentStatus: VersionDiffContentStatusSchema,
});

export type VersionFileChange = z.infer<typeof VersionFileChangeSchema>;

export const GetVersionChangesParamsSchema = z.object({
  appId: z.number(),
  // Must be a hex commit SHA. This is appended as a positional argument to
  // native `git diff-tree`/`cat-file`; constraining it to hex characters
  // prevents a dash-prefixed value from being interpreted as a git option.
  versionId: z
    .string()
    .regex(/^[0-9a-fA-F]{4,64}$/, "versionId must be a hex commit SHA"),
});

export const GetVersionFileChangeParamsSchema =
  GetVersionChangesParamsSchema.extend({
    filePath: z
      .string()
      .min(1)
      .max(4_096)
      .refine((value) => !value.includes("\0"), "filePath contains a NUL byte")
      .refine(
        (value) =>
          !value.startsWith("/") &&
          !/^[a-zA-Z]:[\\/]/.test(value) &&
          !value.split(/[\\/]/).includes(".."),
        "filePath must be repository-relative",
      ),
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
export const VersionCursorSchema = z.object({
  head: CommitHashSchema,
  offset: z.number().int().min(1).max(MAX_VERSION_CURSOR_OFFSET),
});
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
    input: z.object({
      appId: z.number(),
      cursor: VersionCursorSchema.optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_VERSION_PAGE_SIZE)
        .default(DEFAULT_VERSION_PAGE_SIZE),
    }),
    output: z.object({
      versions: z.array(VersionSchema),
      nextCursor: VersionCursorSchema.nullable(),
      totalCount: z.number().int().nonnegative().nullable(),
    }),
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
    output: VersionChangesResultSchema,
  }),

  getVersionFileChange: defineContract({
    channel: "get-version-file-change",
    input: GetVersionFileChangeParamsSchema,
    output: VersionFileChangeSchema,
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

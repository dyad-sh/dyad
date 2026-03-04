import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Media Schemas
// =============================================================================

/**
 * Schema for a single media file item.
 */
const MediaFileSchema = z.object({
  fileName: z.string(),
  filePath: z.string(),
  appId: z.number(),
  appName: z.string(),
  sizeBytes: z.number(),
  mimeType: z.string(),
});

export type MediaFile = z.infer<typeof MediaFileSchema>;

/**
 * Schema for listing all media across all apps.
 */
export const ListAllMediaResponseSchema = z.object({
  apps: z.array(
    z.object({
      appId: z.number(),
      appName: z.string(),
      appPath: z.string(),
      files: z.array(MediaFileSchema),
    }),
  ),
});

export const RenameMediaFileParamsSchema = z.object({
  appId: z.number(),
  fileName: z.string(),
  newBaseName: z.string().min(1),
});

export const DeleteMediaFileParamsSchema = z.object({
  appId: z.number(),
  fileName: z.string(),
});

export const MoveMediaFileParamsSchema = z.object({
  sourceAppId: z.number(),
  fileName: z.string(),
  targetAppId: z.number(),
});

// =============================================================================
// Media Contracts
// =============================================================================

export const mediaContracts = {
  listAllMedia: defineContract({
    channel: "list-all-media",
    input: z.void(),
    output: ListAllMediaResponseSchema,
  }),

  renameMediaFile: defineContract({
    channel: "rename-media-file",
    input: RenameMediaFileParamsSchema,
    output: z.void(),
  }),

  deleteMediaFile: defineContract({
    channel: "delete-media-file",
    input: DeleteMediaFileParamsSchema,
    output: z.void(),
  }),

  moveMediaFile: defineContract({
    channel: "move-media-file",
    input: MoveMediaFileParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Media Client
// =============================================================================

export const mediaClient = createClient(mediaContracts);

// =============================================================================
// Type Exports
// =============================================================================

export type RenameMediaFileParams = z.infer<typeof RenameMediaFileParamsSchema>;
export type DeleteMediaFileParams = z.infer<typeof DeleteMediaFileParamsSchema>;
export type MoveMediaFileParams = z.infer<typeof MoveMediaFileParamsSchema>;

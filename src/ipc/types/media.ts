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

/**
 * A locally stored image or video, from either the file vault or an app's
 * media folder. Everything needed to render it comes back in one item so the
 * gallery never has to care where it lives.
 */
const LocalMediaItemSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  filePath: z.string(),
  /** dyad-media:// URL the renderer can put straight into <img>/<video>. */
  url: z.string(),
  kind: z.enum(["image", "video"]),
  sizeBytes: z.number(),
  mimeType: z.string(),
  modifiedAt: z.number(),
  source: z.enum(["vault", "app"]),
  /** Human-readable origin, e.g. "Vault · Images/Generated" or an app name. */
  sourceLabel: z.string(),
});

export type LocalMediaItem = z.infer<typeof LocalMediaItemSchema>;

export const ListLocalMediaResponseSchema = z.object({
  items: z.array(LocalMediaItemSchema),
  /** Null when no local vault is configured. */
  vaultPath: z.string().nullable(),
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

  /** Images and videos on this machine: file vault + every app media folder. */
  listLocalMedia: defineContract({
    channel: "list-local-media",
    input: z.void(),
    output: ListLocalMediaResponseSchema,
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

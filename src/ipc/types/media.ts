import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Media Schemas
// =============================================================================

/**
 * Schema for a single media file item.
 */
export const MediaFileSchema = z.object({
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
 * Schema for reading a media file as base64.
 */
export const ReadMediaFileParamsSchema = z.object({
  appId: z.number(),
  fileName: z.string(),
});

export const ReadMediaFileResponseSchema = z.object({
  base64Data: z.string(),
  mimeType: z.string(),
  fileName: z.string(),
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

  readMediaFile: defineContract({
    channel: "read-media-file",
    input: ReadMediaFileParamsSchema,
    output: ReadMediaFileResponseSchema,
  }),
} as const;

// =============================================================================
// Media Client
// =============================================================================

export const mediaClient = createClient(mediaContracts);

// =============================================================================
// Type Exports
// =============================================================================

export type ListAllMediaResponse = z.infer<typeof ListAllMediaResponseSchema>;
export type ReadMediaFileParams = z.infer<typeof ReadMediaFileParamsSchema>;
export type ReadMediaFileResponse = z.infer<typeof ReadMediaFileResponseSchema>;

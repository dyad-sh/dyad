import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Image Generation Schemas
// =============================================================================

export const ImageThemeModeSchema = z.enum([
  "plain",
  "3d-clay",
  "real-photography",
  "isometric-illustration",
]);

export type ImageThemeMode = z.infer<typeof ImageThemeModeSchema>;

export const GenerateImageParamsSchema = z.object({
  prompt: z.string().min(1).max(2000),
  themeMode: ImageThemeModeSchema,
  targetAppId: z.number(),
});

export type GenerateImageParams = z.infer<typeof GenerateImageParamsSchema>;

export const GenerateImageResponseSchema = z.object({
  fileName: z.string(),
  filePath: z.string(),
  appId: z.number(),
  appName: z.string(),
});

export type GenerateImageResponse = z.infer<typeof GenerateImageResponseSchema>;

// =============================================================================
// Image Generation Contracts
// =============================================================================

export const imageGenerationContracts = {
  generateImage: defineContract({
    channel: "generate-image",
    input: GenerateImageParamsSchema,
    output: GenerateImageResponseSchema,
  }),
} as const;

// =============================================================================
// Image Generation Client
// =============================================================================

export const imageGenerationClient = createClient(imageGenerationContracts);

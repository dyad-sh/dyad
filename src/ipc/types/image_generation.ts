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
  requestId: z.string(),
});

export const CancelImageGenerationParamsSchema = z.object({
  requestId: z.string(),
});

export const CancelImageGenerationResponseSchema = z.object({
  cancelled: z.boolean(),
});

export type GenerateImageParams = z.infer<typeof GenerateImageParamsSchema>;

// Schema for the raw API response from the image generation service
export const ImageGenerationApiResponseSchema = z.object({
  created: z.number(),
  data: z.array(
    z.object({
      url: z.string().nullable().optional(),
      b64_json: z.string().nullable().optional(),
      revised_prompt: z.string().nullable().optional(),
    }),
  ),
});

export const GenerateImageResponseSchema = z.object({
  fileName: z.string(),
  filePath: z.string(),
  appPath: z.string(),
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
  cancelImageGeneration: defineContract({
    channel: "cancel-image-generation",
    input: CancelImageGenerationParamsSchema,
    output: CancelImageGenerationResponseSchema,
  }),
} as const;

// =============================================================================
// Image Generation Client
// =============================================================================

export const imageGenerationClient = createClient(imageGenerationContracts);

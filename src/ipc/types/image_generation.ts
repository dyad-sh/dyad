import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";
import type {
  GenerateImageResponse,
  ImageThemeMode,
} from "@/image_generation/state";

export type { GenerateImageResponse, ImageThemeMode };

// =============================================================================
// Image Generation Schemas
// =============================================================================

export const ImageThemeModeSchema = z.enum([
  "plain",
  "3d-clay",
  "real-photography",
  "isometric-illustration",
]);

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

type MutuallyAssignable<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;
type AssertTrue<Value extends true> = Value;

// The machine state stays zod-free, so pin its hand-written boundary types to
// the runtime IPC schemas here. Either side drifting must fail type-checking.
const imageGenerationSchemaTypeAssertions: [
  AssertTrue<
    MutuallyAssignable<
      z.infer<typeof GenerateImageResponseSchema>,
      GenerateImageResponse
    >
  >,
  AssertTrue<
    MutuallyAssignable<z.infer<typeof ImageThemeModeSchema>, ImageThemeMode>
  >,
] = [true, true];
void imageGenerationSchemaTypeAssertions;

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

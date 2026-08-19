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
// Image Agent (OpenRouter — Nano Banana 2 / Gemini 3.1 Flash Image)
// =============================================================================

/** Default OpenRouter model for the Image Agent: "Nano Banana 2". */
export const NANO_BANANA_2_MODEL = "google/gemini-3.1-flash-image-preview";
export const NANO_BANANA_2_LABEL = "Nano Banana 2";

export const GenerateAgentImageParamsSchema = z.object({
  prompt: z.string().min(1).max(4000),
  /** Provider selected for the Image role. */
  provider: z.string().optional(),
  /** Provider-native model id. Defaults to Nano Banana 2 on OpenRouter. */
  model: z.string().optional(),
  /** Optional reference image (data URL) for image editing. */
  inputImage: z.string().optional(),
  /** Supply to make the request cancellable via cancelImageGeneration. */
  requestId: z.string().optional(),
});

export type GenerateAgentImageParams = z.infer<
  typeof GenerateAgentImageParamsSchema
>;

export const GenerateAgentImageResponseSchema = z.object({
  /** Generated images as base64 data URLs. */
  images: z.array(z.string()),
  /** Any accompanying text the model returned. */
  text: z.string().optional(),
  /** The model id that produced the images. */
  model: z.string(),
  /** The provider that actually rendered the image. */
  provider: z.string(),
  /** Present when a text-only selection was routed to another backend. */
  routedFromProvider: z.string().optional(),
  /** Text provider used to turn the request into a production image prompt. */
  promptProvider: z.string().optional(),
  /** Text model used to prepare the production image prompt. */
  promptModel: z.string().optional(),
});

export type GenerateAgentImageResponse = z.infer<
  typeof GenerateAgentImageResponseSchema
>;

export const SaveImageToLibraryParamsSchema = z.object({
  /** A base64 data URL or an HTTPS image URL. */
  image: z.string(),
  /** Used to derive a friendly filename. */
  prompt: z.string().max(2000).optional(),
});

export type SaveImageToLibraryParams = z.infer<
  typeof SaveImageToLibraryParamsSchema
>;

export const SaveImageToLibraryResponseSchema = z.object({
  fileName: z.string(),
  appId: z.number(),
  appName: z.string(),
  /** Public Vercel Blob URL when cloud storage is connected. */
  blobUrl: z.string().optional(),
  /** Configured durable storage destination that received the image. */
  storageDestination: z.enum(["local", "cloud"]).optional(),
  /** Absolute vault path when the selected destination is local. */
  localVaultPath: z.string().optional(),
});

/** A selectable OpenRouter image-generation model. */
export const OpenRouterImageModelSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type OpenRouterImageModel = z.infer<typeof OpenRouterImageModelSchema>;

export const ListImageModelsResponseSchema = z.object({
  models: z.array(OpenRouterImageModelSchema),
});

/** Lenient schema for OpenRouter's /models list response. */
export const OpenRouterModelsListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      architecture: z
        .object({
          output_modalities: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ),
});

/** Lenient schema for OpenRouter's chat-completions image response. */
export const OpenRouterImageApiResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.unknown().optional(),
        images: z
          .array(
            z.object({
              image_url: z.object({ url: z.string() }),
            }),
          )
          .optional(),
      }),
    }),
  ),
});

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
  generateAgentImage: defineContract({
    channel: "generate-agent-image",
    input: GenerateAgentImageParamsSchema,
    output: GenerateAgentImageResponseSchema,
  }),
  listImageModels: defineContract({
    channel: "list-openrouter-image-models",
    input: z.void(),
    output: ListImageModelsResponseSchema,
  }),
  saveImageToLibrary: defineContract({
    channel: "save-agent-image-to-library",
    input: SaveImageToLibraryParamsSchema,
    output: SaveImageToLibraryResponseSchema,
  }),
} as const;

// =============================================================================
// Image Generation Client
// =============================================================================

export const imageGenerationClient = createClient(imageGenerationContracts);

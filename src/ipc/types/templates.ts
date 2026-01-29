import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Template Schemas
// =============================================================================

// Import the shared Template type
// Note: The actual Template type is defined in shared/templates.ts
// We create a compatible Zod schema here
export const TemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  imageUrl: z.string(),
  githubUrl: z.string().optional(),
  isOfficial: z.boolean(),
  isExperimental: z.boolean().optional(),
  requiresNeon: z.boolean().optional(),
});

export type Template = z.infer<typeof TemplateSchema>;

// Theme schema (similar structure)
export const ThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  prompt: z.string(),
});

export type Theme = z.infer<typeof ThemeSchema>;

export const SetAppThemeParamsSchema = z.object({
  appId: z.number(),
  themeId: z.string().nullable(),
});

export type SetAppThemeParams = z.infer<typeof SetAppThemeParamsSchema>;

export const GetAppThemeParamsSchema = z.object({
  appId: z.number(),
});

export type GetAppThemeParams = z.infer<typeof GetAppThemeParamsSchema>;

// =============================================================================
// Custom Theme Schemas
// =============================================================================

export const CustomThemeSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  prompt: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CustomTheme = z.infer<typeof CustomThemeSchema>;

export const CreateCustomThemeParamsSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
});

export type CreateCustomThemeParams = z.infer<
  typeof CreateCustomThemeParamsSchema
>;

export const UpdateCustomThemeParamsSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
});

export type UpdateCustomThemeParams = z.infer<
  typeof UpdateCustomThemeParamsSchema
>;

export const DeleteCustomThemeParamsSchema = z.object({
  id: z.number(),
});

export type DeleteCustomThemeParams = z.infer<
  typeof DeleteCustomThemeParamsSchema
>;

// Theme generation types
export const ThemeGenerationModeSchema = z.enum(["inspired", "high-fidelity"]);
export type ThemeGenerationMode = z.infer<typeof ThemeGenerationModeSchema>;

export const ThemeGenerationModelSchema = z.enum([
  "gemini-3-pro",
  "claude-opus-4.5",
  "gpt-5.2",
]);
export type ThemeGenerationModel = z.infer<typeof ThemeGenerationModelSchema>;

// Theme input source (images or URL)
export const ThemeInputSourceSchema = z.enum(["images", "url"]);
export type ThemeInputSource = z.infer<typeof ThemeInputSourceSchema>;

// Crawl status for UI feedback
export const CrawlStatusSchema = z.enum(["crawling", "complete", "error"]);
export type CrawlStatus = z.infer<typeof CrawlStatusSchema>;

export const GenerateThemePromptParamsSchema = z.object({
  imagePaths: z.array(z.string()),
  keywords: z.string(),
  generationMode: ThemeGenerationModeSchema,
  model: ThemeGenerationModelSchema,
});

export type GenerateThemePromptParams = z.infer<
  typeof GenerateThemePromptParamsSchema
>;

export const GenerateThemePromptResultSchema = z.object({
  prompt: z.string(),
});

export type GenerateThemePromptResult = z.infer<
  typeof GenerateThemePromptResultSchema
>;

// URL-based theme generation params
export const GenerateThemeFromUrlParamsSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Only HTTP and HTTPS URLs are supported" },
    ),
  keywords: z.string(),
  generationMode: ThemeGenerationModeSchema,
  model: ThemeGenerationModelSchema,
});

export type GenerateThemeFromUrlParams = z.infer<
  typeof GenerateThemeFromUrlParamsSchema
>;

export const SaveThemeImageParamsSchema = z.object({
  data: z.string(),
  filename: z.string(),
});

export type SaveThemeImageParams = z.infer<typeof SaveThemeImageParamsSchema>;

export const SaveThemeImageResultSchema = z.object({
  path: z.string(),
});

export type SaveThemeImageResult = z.infer<typeof SaveThemeImageResultSchema>;

export const CleanupThemeImagesParamsSchema = z.object({
  paths: z.array(z.string()),
});

export type CleanupThemeImagesParams = z.infer<
  typeof CleanupThemeImagesParamsSchema
>;

// =============================================================================
// Template/Theme Contracts
// =============================================================================

export const templateContracts = {
  getTemplates: defineContract({
    channel: "get-templates",
    input: z.void(),
    output: z.array(TemplateSchema),
  }),

  getThemes: defineContract({
    channel: "get-themes",
    input: z.void(),
    output: z.array(ThemeSchema),
  }),

  setAppTheme: defineContract({
    channel: "set-app-theme",
    input: SetAppThemeParamsSchema,
    output: z.void(),
  }),

  getAppTheme: defineContract({
    channel: "get-app-theme",
    input: GetAppThemeParamsSchema,
    output: z.string().nullable(),
  }),

  // Custom theme operations
  getCustomThemes: defineContract({
    channel: "get-custom-themes",
    input: z.void(),
    output: z.array(CustomThemeSchema),
  }),

  createCustomTheme: defineContract({
    channel: "create-custom-theme",
    input: CreateCustomThemeParamsSchema,
    output: CustomThemeSchema,
  }),

  updateCustomTheme: defineContract({
    channel: "update-custom-theme",
    input: UpdateCustomThemeParamsSchema,
    output: CustomThemeSchema,
  }),

  deleteCustomTheme: defineContract({
    channel: "delete-custom-theme",
    input: DeleteCustomThemeParamsSchema,
    output: z.void(),
  }),

  // Theme generation operations
  generateThemePrompt: defineContract({
    channel: "generate-theme-prompt",
    input: GenerateThemePromptParamsSchema,
    output: GenerateThemePromptResultSchema,
  }),

  generateThemeFromUrl: defineContract({
    channel: "generate-theme-from-url",
    input: GenerateThemeFromUrlParamsSchema,
    output: GenerateThemePromptResultSchema,
  }),

  saveThemeImage: defineContract({
    channel: "save-theme-image",
    input: SaveThemeImageParamsSchema,
    output: SaveThemeImageResultSchema,
  }),

  cleanupThemeImages: defineContract({
    channel: "cleanup-theme-images",
    input: CleanupThemeImagesParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Template Client
// =============================================================================

export const templateClient = createClient(templateContracts);

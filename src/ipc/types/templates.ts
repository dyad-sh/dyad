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
} as const;

// =============================================================================
// Template Client
// =============================================================================

export const templateClient = createClient(templateContracts);

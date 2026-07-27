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

export const ApplyAppTemplateParamsSchema = z.object({
  appId: z.number(),
  templateId: z.string(),
  chatId: z.number().optional(),
});

export type ApplyAppTemplateParams = z.infer<
  typeof ApplyAppTemplateParamsSchema
>;

export const ApplyAppTemplateResultSchema = z.object({
  applied: z.boolean(),
  // True when the caller should restart the dev server — either because the
  // template was applied, or because the handler stopped a running dev server
  // and made no changes (so the user is left without a running preview).
  needsRestart: z.boolean(),
});

export type ApplyAppTemplateResult = z.infer<
  typeof ApplyAppTemplateResultSchema
>;

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

  applyAppTemplate: defineContract({
    channel: "apply-app-template",
    input: ApplyAppTemplateParamsSchema,
    output: ApplyAppTemplateResultSchema,
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
} as const;

// =============================================================================
// Template Client
// =============================================================================

export const templateClient = createClient(templateContracts);

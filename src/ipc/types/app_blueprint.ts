import { z } from "zod";
import {
  defineEvent,
  createEventClient,
  defineContract,
  createClient,
} from "../contracts/core";

// =============================================================================
// App Blueprint Schemas
// =============================================================================

export const APP_BLUEPRINT_VISUAL_TYPES = [
  "logo",
  "photo",
  "illustration",
  "icon",
  "background",
  "other",
] as const;

export const AppBlueprintVisualTypeSchema = z.enum(APP_BLUEPRINT_VISUAL_TYPES);

export const AppBlueprintVisualSchema = z.object({
  id: z.string(),
  type: AppBlueprintVisualTypeSchema,
  description: z.string(),
  prompt: z.string(),
});

export type AppBlueprintVisual = z.infer<typeof AppBlueprintVisualSchema>;

export const AppBlueprintDataSchema = z.object({
  appName: z.string(),
  userPrompt: z.string(),
  attachments: z.array(z.string()).optional().default([]),
  templateId: z.string(),
  themeId: z.string(),
  designDirection: z.string(),
  primaryColor: z.string(),
  visuals: z.array(AppBlueprintVisualSchema).optional().default([]),
});

export type AppBlueprintData = z.infer<typeof AppBlueprintDataSchema>;

export const AppBlueprintUpdatePayloadSchema = z.object({
  chatId: z.number(),
  data: AppBlueprintDataSchema,
});

export type AppBlueprintUpdatePayload = z.infer<
  typeof AppBlueprintUpdatePayloadSchema
>;

export const AppBlueprintVisualsUpdatePayloadSchema = z.object({
  chatId: z.number(),
  visuals: z.array(AppBlueprintVisualSchema),
  complete: z.boolean().optional().default(false),
});

export type AppBlueprintVisualsUpdatePayload = z.infer<
  typeof AppBlueprintVisualsUpdatePayloadSchema
>;

export const AppBlueprintApproveSchema = z.object({
  chatId: z.number(),
});

export type AppBlueprintApprovePayload = z.infer<
  typeof AppBlueprintApproveSchema
>;

export const APP_BLUEPRINT_EDITABLE_FIELDS = [
  "appName",
  "templateId",
  "themeId",
  "designDirection",
  "primaryColor",
] as const;

export const AppBlueprintEditableFieldSchema = z.enum(
  APP_BLUEPRINT_EDITABLE_FIELDS,
);

export type AppBlueprintEditableField = z.infer<
  typeof AppBlueprintEditableFieldSchema
>;

export const AppBlueprintFieldEditSchema = z.object({
  chatId: z.number(),
  field: AppBlueprintEditableFieldSchema,
  value: z.string(),
});

export type AppBlueprintFieldEditPayload = z.infer<
  typeof AppBlueprintFieldEditSchema
>;

export const APP_BLUEPRINT_VISUAL_EDITABLE_FIELDS = [
  "prompt",
  "description",
] as const;

export const AppBlueprintVisualEditableFieldSchema = z.enum(
  APP_BLUEPRINT_VISUAL_EDITABLE_FIELDS,
);

export type AppBlueprintVisualEditableField = z.infer<
  typeof AppBlueprintVisualEditableFieldSchema
>;

export const AppBlueprintVisualEditSchema = z.object({
  chatId: z.number(),
  visualId: z.string(),
  field: AppBlueprintVisualEditableFieldSchema,
  value: z.string(),
});

export type AppBlueprintVisualEditPayload = z.infer<
  typeof AppBlueprintVisualEditSchema
>;

export const AppBlueprintAddVisualSchema = z.object({
  chatId: z.number(),
  type: AppBlueprintVisualTypeSchema,
  description: z.string(),
  prompt: z.string(),
});

export type AppBlueprintAddVisualPayload = z.infer<
  typeof AppBlueprintAddVisualSchema
>;

export const AppBlueprintRemoveVisualSchema = z.object({
  chatId: z.number(),
  visualId: z.string(),
});

export type AppBlueprintRemoveVisualPayload = z.infer<
  typeof AppBlueprintRemoveVisualSchema
>;

export const AppBlueprintApprovedSchema = z.object({
  chatId: z.number(),
});

export type AppBlueprintApprovedPayload = z.infer<
  typeof AppBlueprintApprovedSchema
>;

export const AppBlueprintTimeoutSchema = z.object({
  chatId: z.number(),
});

export type AppBlueprintTimeoutPayload = z.infer<
  typeof AppBlueprintTimeoutSchema
>;

// =============================================================================
// App Blueprint Events (Main -> Renderer)
// =============================================================================

export const appBlueprintEvents = {
  update: defineEvent({
    channel: "app-blueprint:update",
    payload: AppBlueprintUpdatePayloadSchema,
  }),

  visualsUpdate: defineEvent({
    channel: "app-blueprint:visuals-update",
    payload: AppBlueprintVisualsUpdatePayloadSchema,
  }),

  approved: defineEvent({
    channel: "app-blueprint:approved",
    payload: AppBlueprintApprovedSchema,
  }),

  timeout: defineEvent({
    channel: "app-blueprint:timeout",
    payload: AppBlueprintTimeoutSchema,
  }),
} as const;

// =============================================================================
// App Blueprint Contracts (Renderer -> Main)
// =============================================================================

export const appBlueprintContracts = {
  approve: defineContract({
    channel: "app-blueprint:approve",
    input: AppBlueprintApproveSchema,
    output: z.void(),
  }),

  editField: defineContract({
    channel: "app-blueprint:edit-field",
    input: AppBlueprintFieldEditSchema,
    output: z.void(),
  }),

  editVisual: defineContract({
    channel: "app-blueprint:edit-visual",
    input: AppBlueprintVisualEditSchema,
    output: z.void(),
  }),

  addVisual: defineContract({
    channel: "app-blueprint:add-visual",
    input: AppBlueprintAddVisualSchema,
    output: z.object({ visualId: z.string() }),
  }),

  removeVisual: defineContract({
    channel: "app-blueprint:remove-visual",
    input: AppBlueprintRemoveVisualSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// App Blueprint Clients
// =============================================================================

export const appBlueprintEventClient = createEventClient(appBlueprintEvents);

export const appBlueprintClient = createClient(appBlueprintContracts);

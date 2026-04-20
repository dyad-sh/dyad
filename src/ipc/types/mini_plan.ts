import { z } from "zod";
import {
  defineEvent,
  createEventClient,
  defineContract,
  createClient,
} from "../contracts/core";

// =============================================================================
// Mini Plan Schemas
// =============================================================================

export const MINI_PLAN_VISUAL_TYPES = [
  "logo",
  "photo",
  "illustration",
  "icon",
  "background",
  "other",
] as const;

export const MiniPlanVisualTypeSchema = z.enum(MINI_PLAN_VISUAL_TYPES);

export const MiniPlanVisualSchema = z.object({
  id: z.string(),
  type: MiniPlanVisualTypeSchema,
  description: z.string(),
  prompt: z.string(),
});

export type MiniPlanVisual = z.infer<typeof MiniPlanVisualSchema>;

export const MiniPlanDataSchema = z.object({
  appName: z.string(),
  userPrompt: z.string(),
  attachments: z.array(z.string()).optional().default([]),
  templateId: z.string().optional().default("react"),
  themeId: z.string().optional().default("default"),
  designDirection: z.string(),
  mainColor: z.string(),
  visuals: z.array(MiniPlanVisualSchema).optional().default([]),
});

export type MiniPlanData = z.infer<typeof MiniPlanDataSchema>;

export const MiniPlanUpdatePayloadSchema = z.object({
  chatId: z.number(),
  data: MiniPlanDataSchema,
});

export type MiniPlanUpdatePayload = z.infer<typeof MiniPlanUpdatePayloadSchema>;

export const MiniPlanVisualsUpdatePayloadSchema = z.object({
  chatId: z.number(),
  visuals: z.array(MiniPlanVisualSchema),
  complete: z.boolean().optional().default(false),
});

export type MiniPlanVisualsUpdatePayload = z.infer<
  typeof MiniPlanVisualsUpdatePayloadSchema
>;

export const MiniPlanApproveSchema = z.object({
  chatId: z.number(),
});

export type MiniPlanApprovePayload = z.infer<typeof MiniPlanApproveSchema>;

export const MINI_PLAN_EDITABLE_FIELDS = [
  "appName",
  "templateId",
  "themeId",
  "designDirection",
  "mainColor",
] as const;

export const MiniPlanEditableFieldSchema = z.enum(MINI_PLAN_EDITABLE_FIELDS);

export type MiniPlanEditableField = z.infer<typeof MiniPlanEditableFieldSchema>;

export const MiniPlanFieldEditSchema = z.object({
  chatId: z.number(),
  field: MiniPlanEditableFieldSchema,
  value: z.string(),
});

export type MiniPlanFieldEditPayload = z.infer<typeof MiniPlanFieldEditSchema>;

export const MINI_PLAN_VISUAL_EDITABLE_FIELDS = [
  "prompt",
  "description",
] as const;

export const MiniPlanVisualEditableFieldSchema = z.enum(
  MINI_PLAN_VISUAL_EDITABLE_FIELDS,
);

export type MiniPlanVisualEditableField = z.infer<
  typeof MiniPlanVisualEditableFieldSchema
>;

export const MiniPlanVisualEditSchema = z.object({
  chatId: z.number(),
  visualId: z.string(),
  field: MiniPlanVisualEditableFieldSchema,
  value: z.string(),
});

export type MiniPlanVisualEditPayload = z.infer<
  typeof MiniPlanVisualEditSchema
>;

export const MiniPlanAddVisualSchema = z.object({
  chatId: z.number(),
  type: MiniPlanVisualTypeSchema,
  description: z.string(),
  prompt: z.string(),
});

export type MiniPlanAddVisualPayload = z.infer<typeof MiniPlanAddVisualSchema>;

export const MiniPlanRemoveVisualSchema = z.object({
  chatId: z.number(),
  visualId: z.string(),
});

export type MiniPlanRemoveVisualPayload = z.infer<
  typeof MiniPlanRemoveVisualSchema
>;

export const MiniPlanApprovedSchema = z.object({
  chatId: z.number(),
});

export type MiniPlanApprovedPayload = z.infer<typeof MiniPlanApprovedSchema>;

// =============================================================================
// Mini Plan Events (Main -> Renderer)
// =============================================================================

export const miniPlanEvents = {
  update: defineEvent({
    channel: "mini-plan:update",
    payload: MiniPlanUpdatePayloadSchema,
  }),

  visualsUpdate: defineEvent({
    channel: "mini-plan:visuals-update",
    payload: MiniPlanVisualsUpdatePayloadSchema,
  }),

  approved: defineEvent({
    channel: "mini-plan:approved",
    payload: MiniPlanApprovedSchema,
  }),
} as const;

// =============================================================================
// Mini Plan Contracts (Renderer -> Main)
// =============================================================================

export const miniPlanContracts = {
  approve: defineContract({
    channel: "mini-plan:approve",
    input: MiniPlanApproveSchema,
    output: z.void(),
  }),

  editField: defineContract({
    channel: "mini-plan:edit-field",
    input: MiniPlanFieldEditSchema,
    output: z.void(),
  }),

  editVisual: defineContract({
    channel: "mini-plan:edit-visual",
    input: MiniPlanVisualEditSchema,
    output: z.void(),
  }),

  addVisual: defineContract({
    channel: "mini-plan:add-visual",
    input: MiniPlanAddVisualSchema,
    output: z.object({ visualId: z.string() }),
  }),

  removeVisual: defineContract({
    channel: "mini-plan:remove-visual",
    input: MiniPlanRemoveVisualSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Mini Plan Clients
// =============================================================================

export const miniPlanEventClient = createEventClient(miniPlanEvents);

export const miniPlanClient = createClient(miniPlanContracts);

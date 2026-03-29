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

export const MiniPlanVisualSchema = z.object({
  id: z.string(),
  type: z.enum([
    "logo",
    "photo",
    "illustration",
    "icon",
    "background",
    "other",
  ]),
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
});

export type MiniPlanVisualsUpdatePayload = z.infer<
  typeof MiniPlanVisualsUpdatePayloadSchema
>;

export const MiniPlanApproveSchema = z.object({
  chatId: z.number(),
});

export type MiniPlanApprovePayload = z.infer<typeof MiniPlanApproveSchema>;

export const MiniPlanFieldEditSchema = z.object({
  chatId: z.number(),
  field: z.string(),
  value: z.string(),
});

export type MiniPlanFieldEditPayload = z.infer<typeof MiniPlanFieldEditSchema>;

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
} as const;

// =============================================================================
// Mini Plan Clients
// =============================================================================

export const miniPlanEventClient = createEventClient(miniPlanEvents);

export const miniPlanClient = createClient(miniPlanContracts);

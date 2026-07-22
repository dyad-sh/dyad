import { z } from "zod";
import {
  defineEvent,
  createEventClient,
  defineContract,
  createClient,
} from "../contracts/core";

// Plan Schemas

export const PlanUpdateSchema = z.object({
  chatId: z.number(),
  title: z.string(),
  summary: z.string().optional(),
  plan: z.string(),
});

export type PlanUpdatePayload = z.infer<typeof PlanUpdateSchema>;

export const PlanExitSchema = z.object({
  chatId: z.number(),
  appId: z.number(),
});

export type PlanExitPayload = z.infer<typeof PlanExitSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  appId: z.number(),
  chatId: z.number().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  content: z.string(),
  // "draft" while the user is still reviewing the plan, "accepted" once they
  // choose to implement it. Legacy plans without a status are treated as
  // "accepted".
  status: z.enum(["draft", "accepted"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Plan = z.infer<typeof PlanSchema>;

export const CreatePlanParamsSchema = z.object({
  appId: z.number(),
  chatId: z.number(),
  title: z.string(),
  summary: z.string().optional(),
  content: z.string(),
});

export type CreatePlanParams = z.infer<typeof CreatePlanParamsSchema>;

export const UpdatePlanParamsSchema = z.object({
  appId: z.number(),
  id: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
});

export type UpdatePlanParams = z.infer<typeof UpdatePlanParamsSchema>;

// Plan Event Contracts (Main -> Renderer)

export const planEvents = {
  update: defineEvent({
    channel: "plan:update",
    payload: PlanUpdateSchema,
  }),

  exit: defineEvent({
    channel: "plan:exit",
    payload: PlanExitSchema,
  }),
} as const;

// Plan CRUD Contracts (Invoke/Response)

export const planContracts = {
  createPlan: defineContract({
    channel: "plan:create",
    input: CreatePlanParamsSchema,
    output: z.string(),
  }),

  getPlan: defineContract({
    channel: "plan:get",
    input: z.object({ appId: z.number(), planId: z.string() }),
    output: PlanSchema,
  }),

  getPlanForChat: defineContract({
    channel: "plan:get-for-chat",
    input: z.object({ appId: z.number(), chatId: z.number() }),
    output: PlanSchema.nullable(),
  }),

  updatePlan: defineContract({
    channel: "plan:update-plan",
    input: UpdatePlanParamsSchema,
    output: z.void(),
  }),

  deletePlan: defineContract({
    channel: "plan:delete",
    input: z.object({ appId: z.number(), planId: z.string() }),
    output: z.void(),
  }),
} as const;

// Plan Clients

export const planEventClient = createEventClient(planEvents);

export const planClient = createClient(planContracts);

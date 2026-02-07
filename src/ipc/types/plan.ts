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
});

export type PlanExitPayload = z.infer<typeof PlanExitSchema>;

const TextQuestionSchema = z.object({
  id: z.string(),
  type: z.literal("text"),
  question: z.string(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
});

const MultipleChoiceQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["radio", "checkbox"]),
  question: z.string(),
  options: z.array(z.string()).min(1),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
});

export const QuestionSchema = z.union([
  TextQuestionSchema,
  MultipleChoiceQuestionSchema,
]);

export type Question = z.infer<typeof QuestionSchema>;

export const PlanQuestionnaireSchema = z.object({
  chatId: z.number(),
  title: z.string(),
  description: z.string().optional(),
  questions: z.array(QuestionSchema),
});

export type PlanQuestionnairePayload = z.infer<typeof PlanQuestionnaireSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  appId: z.number(),
  chatId: z.number().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  content: z.string(),
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

  questionnaire: defineEvent({
    channel: "plan:questionnaire",
    payload: PlanQuestionnaireSchema,
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

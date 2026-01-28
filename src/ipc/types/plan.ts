import { z } from "zod";
import {
  defineEvent,
  createEventClient,
  defineContract,
  createClient,
} from "../contracts/core";

// =============================================================================
// Plan Schemas
// =============================================================================

/**
 * Schema for plan update payload.
 */
export const PlanUpdateSchema = z.object({
  chatId: z.number(),
  title: z.string(),
  summary: z.string().optional(),
  plan: z.string(),
});

export type PlanUpdatePayload = z.infer<typeof PlanUpdateSchema>;

/**
 * Schema for plan exit payload.
 */
export const PlanExitSchema = z.object({
  chatId: z.number(),
  implementationNotes: z.string().optional(),
});

export type PlanExitPayload = z.infer<typeof PlanExitSchema>;

/**
 * Schema for a questionnaire question.
 */
export const QuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "radio", "checkbox", "select"]),
  question: z.string(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
});

export type Question = z.infer<typeof QuestionSchema>;

/**
 * Schema for a planning questionnaire payload.
 */
export const PlanQuestionnaireSchema = z.object({
  chatId: z.number(),
  title: z.string(),
  description: z.string().optional(),
  questions: z.array(QuestionSchema),
});

export type PlanQuestionnairePayload = z.infer<typeof PlanQuestionnaireSchema>;

/**
 * Schema for a persisted plan.
 */
export const PlanSchema = z.object({
  id: z.number(),
  appId: z.number(),
  chatId: z.number().nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  content: z.string(),
  status: z.enum(["draft", "accepted", "rejected", "implemented"]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Plan = z.infer<typeof PlanSchema>;

/**
 * Schema for creating a new plan.
 */
export const CreatePlanParamsSchema = z.object({
  appId: z.number(),
  chatId: z.number().optional(),
  title: z.string(),
  summary: z.string().optional(),
  content: z.string(),
});

export type CreatePlanParams = z.infer<typeof CreatePlanParamsSchema>;

/**
 * Schema for updating a plan.
 */
export const UpdatePlanParamsSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  status: z.enum(["draft", "accepted", "rejected", "implemented"]).optional(),
});

export type UpdatePlanParams = z.infer<typeof UpdatePlanParamsSchema>;

// =============================================================================
// Plan Event Contracts (Main -> Renderer)
// =============================================================================

export const planEvents = {
  /**
   * Emitted when the agent creates or updates a plan.
   */
  update: defineEvent({
    channel: "plan:update",
    payload: PlanUpdateSchema,
  }),

  /**
   * Emitted when the agent exits plan mode (user accepted the plan).
   */
  exit: defineEvent({
    channel: "plan:exit",
    payload: PlanExitSchema,
  }),

  /**
   * Emitted when the agent presents a questionnaire.
   */
  questionnaire: defineEvent({
    channel: "plan:questionnaire",
    payload: PlanQuestionnaireSchema,
  }),
} as const;

// =============================================================================
// Plan CRUD Contracts (Invoke/Response)
// =============================================================================

export const planContracts = {
  /**
   * Create a new plan.
   */
  createPlan: defineContract({
    channel: "plan:create",
    input: CreatePlanParamsSchema,
    output: z.number(), // Returns plan ID
  }),

  /**
   * Get a plan by ID.
   */
  getPlan: defineContract({
    channel: "plan:get",
    input: z.number(), // planId
    output: PlanSchema,
  }),

  /**
   * Get all plans for an app.
   */
  getPlansForApp: defineContract({
    channel: "plan:get-for-app",
    input: z.number(), // appId
    output: z.array(PlanSchema),
  }),

  /**
   * Update a plan.
   */
  updatePlan: defineContract({
    channel: "plan:update-plan",
    input: UpdatePlanParamsSchema,
    output: z.void(),
  }),

  /**
   * Delete a plan.
   */
  deletePlan: defineContract({
    channel: "plan:delete",
    input: z.number(), // planId
    output: z.void(),
  }),
} as const;

// =============================================================================
// Plan Clients
// =============================================================================

/**
 * Type-safe event client for plan events.
 *
 * @example
 * const unsubscribe = planEventClient.onUpdate((payload) => {
 *   updatePlanContent(payload);
 * });
 * // Later: unsubscribe();
 */
export const planEventClient = createEventClient(planEvents);

/**
 * Type-safe client for plan CRUD operations.
 *
 * @example
 * const planId = await planClient.createPlan({ appId, title, content });
 * const plans = await planClient.getPlansForApp(appId);
 */
export const planClient = createClient(planContracts);

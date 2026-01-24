import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Prompt Schemas
// =============================================================================

export const PromptDtoSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  content: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type PromptDto = z.infer<typeof PromptDtoSchema>;

export const CreatePromptParamsDtoSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  content: z.string(),
});

export type CreatePromptParamsDto = z.infer<typeof CreatePromptParamsDtoSchema>;

export const UpdatePromptParamsDtoSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
});

export type UpdatePromptParamsDto = z.infer<typeof UpdatePromptParamsDtoSchema>;

// =============================================================================
// Prompt Contracts
// =============================================================================

export const promptContracts = {
  list: defineContract({
    channel: "prompts:list",
    input: z.void(),
    output: z.array(PromptDtoSchema),
  }),

  create: defineContract({
    channel: "prompts:create",
    input: CreatePromptParamsDtoSchema,
    output: PromptDtoSchema,
  }),

  update: defineContract({
    channel: "prompts:update",
    input: UpdatePromptParamsDtoSchema,
    output: z.void(),
  }),

  delete: defineContract({
    channel: "prompts:delete",
    input: z.number(), // id
    output: z.void(),
  }),
} as const;

// =============================================================================
// Prompt Client
// =============================================================================

export const promptClient = createClient(promptContracts);

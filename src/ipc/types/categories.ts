import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Category Schemas
// =============================================================================

export const CategoryDtoSchema = z.object({
  id: z.number(),
  name: z.string(),
  appIds: z.array(z.number()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CategoryDto = z.infer<typeof CategoryDtoSchema>;

export const CreateCategoryParamsSchema = z.object({
  name: z.string().min(1),
  appIds: z.array(z.number()).optional(),
});

export type CreateCategoryParams = z.infer<typeof CreateCategoryParamsSchema>;

export const UpdateCategoryParamsSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  appIds: z.array(z.number()).optional(),
});

export type UpdateCategoryParams = z.infer<typeof UpdateCategoryParamsSchema>;

export const AssignAppsParamsSchema = z.object({
  categoryId: z.number().nullable(),
  appIds: z.array(z.number()),
});

export type AssignAppsParams = z.infer<typeof AssignAppsParamsSchema>;

// =============================================================================
// Category Contracts
// =============================================================================

export const categoryContracts = {
  list: defineContract({
    channel: "categories:list",
    input: z.void(),
    output: z.array(CategoryDtoSchema),
  }),

  create: defineContract({
    channel: "categories:create",
    input: CreateCategoryParamsSchema,
    output: CategoryDtoSchema,
  }),

  update: defineContract({
    channel: "categories:update",
    input: UpdateCategoryParamsSchema,
    output: z.void(),
  }),

  delete: defineContract({
    channel: "categories:delete",
    input: z.number(),
    output: z.void(),
  }),

  assignApps: defineContract({
    channel: "categories:assignApps",
    input: AssignAppsParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Category Client
// =============================================================================

export const categoryClient = createClient(categoryContracts);

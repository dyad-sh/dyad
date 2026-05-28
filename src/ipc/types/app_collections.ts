import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// AppCollection Schemas
// =============================================================================

export const AppCollectionDtoSchema = z.object({
  id: z.number(),
  name: z.string(),
  appIds: z.array(z.number()),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AppCollectionDto = z.infer<typeof AppCollectionDtoSchema>;

export const CreateAppCollectionParamsSchema = z.object({
  name: z.string().min(1),
  appIds: z.array(z.number()).optional(),
});

export type CreateAppCollectionParams = z.infer<
  typeof CreateAppCollectionParamsSchema
>;

export const UpdateAppCollectionParamsSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  appIds: z.array(z.number()).optional(),
});

export type UpdateAppCollectionParams = z.infer<
  typeof UpdateAppCollectionParamsSchema
>;

export const AssignAppsParamsSchema = z.object({
  collectionId: z.number().nullable(),
  appIds: z.array(z.number()),
});

export type AssignAppsParams = z.infer<typeof AssignAppsParamsSchema>;

// =============================================================================
// AppCollection Contracts
// =============================================================================

export const appCollectionContracts = {
  list: defineContract({
    channel: "appCollections:list",
    input: z.void(),
    output: z.array(AppCollectionDtoSchema),
  }),

  create: defineContract({
    channel: "appCollections:create",
    input: CreateAppCollectionParamsSchema,
    output: AppCollectionDtoSchema,
  }),

  update: defineContract({
    channel: "appCollections:update",
    input: UpdateAppCollectionParamsSchema,
    output: z.void(),
  }),

  delete: defineContract({
    channel: "appCollections:delete",
    input: z.number(),
    output: z.void(),
  }),

  assignApps: defineContract({
    channel: "appCollections:assignApps",
    input: AssignAppsParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// AppCollection Client
// =============================================================================

export const appCollectionClient = createClient(appCollectionContracts);

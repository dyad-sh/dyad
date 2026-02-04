import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Memory Schemas
// =============================================================================

export const MemoryDtoSchema = z.object({
  id: z.number(),
  appId: z.number(),
  content: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type MemoryDto = z.infer<typeof MemoryDtoSchema>;

export const CreateMemoryParamsSchema = z.object({
  appId: z.number(),
  content: z.string(),
});

export type CreateMemoryParams = z.infer<typeof CreateMemoryParamsSchema>;

export const UpdateMemoryParamsSchema = z.object({
  id: z.number(),
  content: z.string(),
});

export type UpdateMemoryParams = z.infer<typeof UpdateMemoryParamsSchema>;

// =============================================================================
// Memory Contracts
// =============================================================================

export const memoryContracts = {
  listByApp: defineContract({
    channel: "memories:list-by-app",
    input: z.number(), // appId
    output: z.array(MemoryDtoSchema),
  }),

  create: defineContract({
    channel: "memories:create",
    input: CreateMemoryParamsSchema,
    output: MemoryDtoSchema,
  }),

  update: defineContract({
    channel: "memories:update",
    input: UpdateMemoryParamsSchema,
    output: z.void(),
  }),

  delete: defineContract({
    channel: "memories:delete",
    input: z.number(), // id
    output: z.void(),
  }),
} as const;

// =============================================================================
// Memory Client
// =============================================================================

export const memoryClient = createClient(memoryContracts);

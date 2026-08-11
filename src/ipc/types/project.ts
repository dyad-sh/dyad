import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/**
 * Contracts for projects.
 *
 * A project is a named working context with standing instructions. Those
 * instructions reach the model, so they are stored and returned as plain text
 * the user wrote and can read back: nothing here is a credential, and nothing
 * is generated on the user's behalf.
 */

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  instructions: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Project = z.infer<typeof ProjectSchema>;

const ProjectInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  instructions: z.string().max(20_000).optional(),
});

export const projectContracts = {
  list: defineContract({
    channel: "project:list",
    input: z.void(),
    output: z.array(ProjectSchema),
  }),
  create: defineContract({
    channel: "project:create",
    input: ProjectInputSchema,
    output: ProjectSchema,
  }),
  update: defineContract({
    channel: "project:update",
    input: ProjectInputSchema.partial().extend({ id: z.string() }),
    output: ProjectSchema,
  }),
  delete: defineContract({
    channel: "project:delete",
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
} as const;

export const projectClient = createClient(projectContracts);

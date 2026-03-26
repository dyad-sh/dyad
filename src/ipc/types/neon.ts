import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Neon Schemas
// =============================================================================

export const NeonProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  connectionString: z.string(),
  branchId: z.string(),
});

export type NeonProject = z.infer<typeof NeonProjectSchema>;

export const CreateNeonProjectParamsSchema = z.object({
  name: z.string(),
  appId: z.number(),
});

export type CreateNeonProjectParams = z.infer<
  typeof CreateNeonProjectParamsSchema
>;

export const GetNeonProjectParamsSchema = z.object({
  appId: z.number(),
});

export type GetNeonProjectParams = z.infer<typeof GetNeonProjectParamsSchema>;

export const NeonBranchSchema = z.object({
  type: z.enum(["production", "development", "snapshot", "preview"]),
  branchId: z.string(),
  branchName: z.string(),
  lastUpdated: z.string(),
  parentBranchId: z.string().nullable().optional(),
  parentBranchName: z.string().optional(),
});

export type NeonBranch = z.infer<typeof NeonBranchSchema>;

export const GetNeonProjectResponseSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  orgId: z.string(),
  branches: z.array(NeonBranchSchema),
});

export type GetNeonProjectResponse = z.infer<
  typeof GetNeonProjectResponseSchema
>;

// Schema for project list items (lighter than full NeonProject)
export const NeonProjectListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  regionId: z.string(),
  createdAt: z.string(),
});

export type NeonProjectListItem = z.infer<typeof NeonProjectListItemSchema>;

export const ListNeonProjectsResponseSchema = z.object({
  projects: z.array(NeonProjectListItemSchema),
});

export type ListNeonProjectsResponse = z.infer<
  typeof ListNeonProjectsResponseSchema
>;

export const SetNeonAppProjectParamsSchema = z.object({
  appId: z.number(),
  projectId: z.string(),
});

export type SetNeonAppProjectParams = z.infer<
  typeof SetNeonAppProjectParamsSchema
>;

export const UnsetNeonAppProjectParamsSchema = z.object({
  appId: z.number(),
});

export type UnsetNeonAppProjectParams = z.infer<
  typeof UnsetNeonAppProjectParamsSchema
>;

export const SetNeonActiveBranchParamsSchema = z.object({
  appId: z.number(),
  branchId: z.string(),
});

export type SetNeonActiveBranchParams = z.infer<
  typeof SetNeonActiveBranchParamsSchema
>;

// =============================================================================
// Neon Contracts
// =============================================================================

export const neonContracts = {
  createProject: defineContract({
    channel: "neon:create-project",
    input: CreateNeonProjectParamsSchema,
    output: NeonProjectSchema,
  }),

  getProject: defineContract({
    channel: "neon:get-project",
    input: GetNeonProjectParamsSchema,
    output: GetNeonProjectResponseSchema,
  }),

  listProjects: defineContract({
    channel: "neon:list-projects",
    input: z.void(),
    output: ListNeonProjectsResponseSchema,
  }),

  setAppProject: defineContract({
    channel: "neon:set-app-project",
    input: SetNeonAppProjectParamsSchema,
    output: z.object({ success: z.boolean() }),
  }),

  unsetAppProject: defineContract({
    channel: "neon:unset-app-project",
    input: UnsetNeonAppProjectParamsSchema,
    output: z.object({ success: z.boolean() }),
  }),

  setActiveBranch: defineContract({
    channel: "neon:set-active-branch",
    input: SetNeonActiveBranchParamsSchema,
    output: z.object({ success: z.boolean() }),
  }),

  fakeConnect: defineContract({
    channel: "neon:fake-connect",
    input: z.void(),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Neon Client
// =============================================================================

export const neonClient = createClient(neonContracts);

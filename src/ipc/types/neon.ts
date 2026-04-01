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

export const ExecuteNeonSqlParamsSchema = z.object({
  appId: z.number(),
  query: z.string(),
});

export type ExecuteNeonSqlParams = z.infer<typeof ExecuteNeonSqlParamsSchema>;

export const GetNeonConnectionUriParamsSchema = z.object({
  appId: z.number(),
});

export type GetNeonConnectionUriParams = z.infer<
  typeof GetNeonConnectionUriParamsSchema
>;

export const GetNeonTableSchemaParamsSchema = z.object({
  appId: z.number(),
  tableName: z.string().optional(),
});

export type GetNeonTableSchemaParams = z.infer<
  typeof GetNeonTableSchemaParamsSchema
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
    output: z.object({
      success: z.boolean(),
      warning: z.string().optional(),
    }),
  }),

  executeSql: defineContract({
    channel: "neon:execute-sql",
    input: ExecuteNeonSqlParamsSchema,
    output: z.object({ result: z.string() }),
  }),

  getConnectionUri: defineContract({
    channel: "neon:get-connection-uri",
    input: GetNeonConnectionUriParamsSchema,
    output: z.object({ connectionUri: z.string() }),
  }),

  getTableSchema: defineContract({
    channel: "neon:get-table-schema",
    input: GetNeonTableSchemaParamsSchema,
    output: z.object({ schema: z.string() }),
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

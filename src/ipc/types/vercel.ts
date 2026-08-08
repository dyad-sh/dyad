import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Vercel Schemas
// =============================================================================

export const VercelProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  framework: z.string().nullable().optional(),
});

export type VercelProject = z.infer<typeof VercelProjectSchema>;

export const VercelDeploymentSchema = z.object({
  uid: z.string(),
  url: z.string(),
  state: z.string(),
  createdAt: z.number(),
  target: z.string(),
  readyState: z.string(),
});

export type VercelDeployment = z.infer<typeof VercelDeploymentSchema>;

export const SaveVercelAccessTokenParamsSchema = z.object({
  token: z.string(),
});

export type SaveVercelAccessTokenParams = z.infer<
  typeof SaveVercelAccessTokenParamsSchema
>;

export const ConnectToExistingVercelProjectParamsSchema = z.object({
  appId: z.number(),
  projectId: z.string(),
});

export type ConnectToExistingVercelProjectParams = z.infer<
  typeof ConnectToExistingVercelProjectParamsSchema
>;

export const IsVercelProjectAvailableParamsSchema = z.object({
  name: z.string(),
});

export type IsVercelProjectAvailableParams = z.infer<
  typeof IsVercelProjectAvailableParamsSchema
>;

export const IsVercelProjectAvailableResponseSchema = z.object({
  available: z.boolean(),
  error: z.string().optional(),
});

export type IsVercelProjectAvailableResponse = z.infer<
  typeof IsVercelProjectAvailableResponseSchema
>;

export const CreateVercelProjectParamsSchema = z.object({
  name: z.string(),
  appId: z.number(),
});

export type CreateVercelProjectParams = z.infer<
  typeof CreateVercelProjectParamsSchema
>;

export const GetVercelDeploymentsParamsSchema = z.object({
  appId: z.number(),
});

export type GetVercelDeploymentsParams = z.infer<
  typeof GetVercelDeploymentsParamsSchema
>;

export const DisconnectVercelProjectParamsSchema = z.object({
  appId: z.number(),
});

export type DisconnectVercelProjectParams = z.infer<
  typeof DisconnectVercelProjectParamsSchema
>;

export const CreateVercelManagerProjectParamsSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const UpdateVercelManagerProjectParamsSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
});

export const DeleteVercelManagerProjectParamsSchema = z.object({
  projectId: z.string().min(1),
});

// =============================================================================
// Vercel Contracts
// =============================================================================

export const vercelContracts = {
  saveToken: defineContract({
    channel: "vercel:save-token",
    input: SaveVercelAccessTokenParamsSchema,
    output: z.void(),
  }),

  listProjects: defineContract({
    channel: "vercel:list-projects",
    input: z.void(),
    output: z.array(VercelProjectSchema),
  }),

  createManagerProject: defineContract({
    channel: "vercel:create-manager-project",
    input: CreateVercelManagerProjectParamsSchema,
    output: VercelProjectSchema,
  }),

  updateManagerProject: defineContract({
    channel: "vercel:update-manager-project",
    input: UpdateVercelManagerProjectParamsSchema,
    output: VercelProjectSchema,
  }),

  deleteManagerProject: defineContract({
    channel: "vercel:delete-manager-project",
    input: DeleteVercelManagerProjectParamsSchema,
    output: z.void(),
  }),

  isProjectAvailable: defineContract({
    channel: "vercel:is-project-available",
    input: IsVercelProjectAvailableParamsSchema,
    output: IsVercelProjectAvailableResponseSchema,
  }),

  createProject: defineContract({
    channel: "vercel:create-project",
    input: CreateVercelProjectParamsSchema,
    output: z.void(),
  }),

  connectExistingProject: defineContract({
    channel: "vercel:connect-existing-project",
    input: ConnectToExistingVercelProjectParamsSchema,
    output: z.void(),
  }),

  getDeployments: defineContract({
    channel: "vercel:get-deployments",
    input: GetVercelDeploymentsParamsSchema,
    output: z.array(VercelDeploymentSchema),
  }),

  disconnect: defineContract({
    channel: "vercel:disconnect",
    input: DisconnectVercelProjectParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Vercel Client
// =============================================================================

export const vercelClient = createClient(vercelContracts);

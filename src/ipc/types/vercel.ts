import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Vercel Schemas
// =============================================================================

/**
 * Where a project's source lives, when Vercel says so.
 *
 * Vercel does not serve project files, so this is the honest substitute: the
 * repository the deployments are built from, which the GitHub workspace can
 * actually open.
 */
export const VercelProjectLinkSchema = z.object({
  type: z.string(),
  org: z.string().nullable(),
  repo: z.string().nullable(),
});

export const VercelProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  framework: z.string().nullable().optional(),
  link: VercelProjectLinkSchema.nullable().optional(),
});

export const VercelDomainSchema = z.object({
  name: z.string(),
  verified: z.boolean(),
  /** Set when the domain points at a specific branch rather than production. */
  gitBranch: z.string().nullable(),
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

  /**
   * Deployments for a Vercel project.
   *
   * getDeployments takes a local app id, so it only covers projects linked to
   * something in this app. This one takes the Vercel project id, which is what
   * the workspace has when browsing the account.
   */
  getProjectDeployments: defineContract({
    channel: "vercel:get-project-deployments",
    input: z.object({
      projectId: z.string(),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    output: z.array(VercelDeploymentSchema),
  }),

  /** Domains attached to a project, as Vercel reports them. */
  getProjectDomains: defineContract({
    channel: "vercel:get-project-domains",
    input: z.object({ projectId: z.string() }),
    output: z.array(VercelDomainSchema),
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

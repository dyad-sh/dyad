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

// --- Neon → Vercel sync ---

export const VercelSyncAppParamsSchema = z.object({
  appId: z.number(),
});

export type VercelSyncAppParams = z.infer<typeof VercelSyncAppParamsSchema>;

export const VercelSyncPreviewSchema = z.object({
  vercelProjectName: z.string().nullable(),
  branchType: z.enum(["production", "development"]),
  envKeys: z.array(z.string()),
  cookieSecretIncluded: z.boolean(),
  target: z.array(z.enum(["production", "preview", "development"])),
  trustedDomainOrigins: z.array(z.string()),
  authActive: z.boolean(),
});

export type VercelSyncPreview = z.infer<typeof VercelSyncPreviewSchema>;

export const VercelSyncResultSchema = z.object({
  envPushed: z.boolean(),
  domainsAdded: z.array(z.string()),
  skipped: z.array(z.string()),
  warning: z.string().optional(),
});

export type VercelSyncResult = z.infer<typeof VercelSyncResultSchema>;

export const RemoveNeonEnvVarsFromVercelResultSchema = z.object({
  removedKeys: z.array(z.string()),
  warning: z.string().optional(),
});

export type RemoveNeonEnvVarsFromVercelResult = z.infer<
  typeof RemoveNeonEnvVarsFromVercelResultSchema
>;

export const CreateVercelProjectResultSchema = z
  .object({
    syncWarning: z.string().optional(),
  })
  .optional();

export type CreateVercelProjectResult = z.infer<
  typeof CreateVercelProjectResultSchema
>;

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

  isProjectAvailable: defineContract({
    channel: "vercel:is-project-available",
    input: IsVercelProjectAvailableParamsSchema,
    output: IsVercelProjectAvailableResponseSchema,
  }),

  createProject: defineContract({
    channel: "vercel:create-project",
    input: CreateVercelProjectParamsSchema,
    output: CreateVercelProjectResultSchema,
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

  getSyncPreview: defineContract({
    channel: "vercel:get-sync-preview",
    input: VercelSyncAppParamsSchema,
    output: VercelSyncPreviewSchema,
  }),

  syncNeonConfig: defineContract({
    channel: "vercel:sync-neon-config",
    input: VercelSyncAppParamsSchema,
    output: VercelSyncResultSchema,
  }),

  removeNeonEnvVars: defineContract({
    channel: "vercel:remove-neon-env-vars",
    input: VercelSyncAppParamsSchema,
    output: RemoveNeonEnvVarsFromVercelResultSchema,
  }),
} as const;

// =============================================================================
// Vercel Client
// =============================================================================

export const vercelClient = createClient(vercelContracts);

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
  confirmSync: z.literal(true),
});

export type CreateVercelProjectParams = z.infer<
  typeof CreateVercelProjectParamsSchema
>;

// =============================================================================
// Vercel Sync Schemas
// =============================================================================

export const VercelSyncTargetSchema = z.enum([
  "production",
  "preview",
  "development",
]);

export const VercelSyncEnvVarSchema = z.object({
  key: z.string(),
  value: z.string(),
  targets: z.array(VercelSyncTargetSchema),
});

export const VercelSyncPlanSchema = z.object({
  envVars: z.array(VercelSyncEnvVarSchema),
  trustedDomain: z
    .object({
      domain: z.string(),
      branchId: z.string(),
    })
    .nullable(),
  vercelProjectName: z.string(),
  branchType: z.enum(["production", "development"]),
  currentHash: z.string(),
  isFirstSync: z.boolean(),
  branchTypeChanged: z.boolean(),
});

export type VercelSyncPlan = z.infer<typeof VercelSyncPlanSchema>;

export const VercelSyncResultSchema = z.object({
  syncedHash: z.string(),
  trustedDomain: z.string().nullable(),
  warning: z.string().optional(),
});

export type VercelSyncResult = z.infer<typeof VercelSyncResultSchema>;

export const VercelDriftStatusSchema = z.object({
  hasDrift: z.boolean(),
  isFirstSync: z.boolean(),
  branchTypeChanged: z.boolean(),
  lastSyncedAt: z.date().nullable(),
});

export type VercelDriftStatus = z.infer<typeof VercelDriftStatusSchema>;

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

  getSyncPlan: defineContract({
    channel: "vercel:get-sync-plan",
    input: z.object({ appId: z.number() }),
    output: VercelSyncPlanSchema,
  }),

  syncToVercel: defineContract({
    channel: "vercel:sync-to-vercel",
    input: z.object({ appId: z.number() }),
    output: VercelSyncResultSchema,
  }),

  getDriftStatus: defineContract({
    channel: "vercel:get-drift-status",
    input: z.object({ appId: z.number() }),
    output: VercelDriftStatusSchema,
  }),

  removeNeonEnvVars: defineContract({
    channel: "vercel:remove-neon-env-vars",
    input: z.object({ appId: z.number() }),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Vercel Client
// =============================================================================

export const vercelClient = createClient(vercelContracts);

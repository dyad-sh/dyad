import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Convex Schemas
// =============================================================================

export const SetConvexAppDeploymentParamsSchema = z.object({
  appId: z.number(),
  deploymentUrl: z.string().nullable().optional(),
});

export type SetConvexAppDeploymentParams = z.infer<
  typeof SetConvexAppDeploymentParamsSchema
>;

// =============================================================================
// Convex Contracts
// =============================================================================

export const convexContracts = {
  setAppDeployment: defineContract({
    channel: "convex:set-app-deployment",
    input: SetConvexAppDeploymentParamsSchema,
    output: z.void(),
  }),

  unsetAppDeployment: defineContract({
    channel: "convex:unset-app-deployment",
    input: z.object({ appId: z.number() }),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Convex Client
// =============================================================================

export const convexClient = createClient(convexContracts);

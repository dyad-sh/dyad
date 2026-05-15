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
  warning: z.string().optional(),
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

export const UnsetNeonAppProjectParamsSchema = z.object({
  appId: z.number(),
});

export const SetNeonActiveBranchParamsSchema = z.object({
  appId: z.number(),
  branchId: z.string(),
});

export const NeonAuthEmailAndPasswordConfigSchema = z.object({
  enabled: z.boolean(),
  email_verification_method: z.enum(["link", "otp"]),
  require_email_verification: z.boolean(),
  auto_sign_in_after_verification: z.boolean(),
  send_verification_email_on_sign_up: z.boolean(),
  send_verification_email_on_sign_in: z.boolean(),
  disable_sign_up: z.boolean(),
});

export type NeonAuthEmailAndPasswordConfig = z.infer<
  typeof NeonAuthEmailAndPasswordConfigSchema
>;

export const GetNeonEmailPasswordConfigParamsSchema = z.object({
  appId: z.number(),
});

export const UpdateNeonEmailVerificationParamsSchema = z.object({
  appId: z.number(),
  requireEmailVerification: z.boolean(),
});

export const GetNeonBranchConnectionUriParamsSchema = z.object({
  appId: z.number(),
  branchType: z.enum(["production", "development"]),
});

export type GetNeonBranchConnectionUriParams = z.infer<
  typeof GetNeonBranchConnectionUriParamsSchema
>;

export const GetNeonBranchConnectionUriResponseSchema = z.object({
  connectionUri: z.string(),
});

export type GetNeonBranchConnectionUriResponse = z.infer<
  typeof GetNeonBranchConnectionUriResponseSchema
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
    output: z.object({
      success: z.boolean(),
      warning: z.string().optional(),
    }),
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

  getEmailPasswordConfig: defineContract({
    channel: "neon:get-email-password-config",
    input: GetNeonEmailPasswordConfigParamsSchema,
    output: NeonAuthEmailAndPasswordConfigSchema,
  }),

  updateEmailVerification: defineContract({
    channel: "neon:update-email-verification",
    input: UpdateNeonEmailVerificationParamsSchema,
    output: NeonAuthEmailAndPasswordConfigSchema,
  }),

  fakeConnect: defineContract({
    channel: "neon:fake-connect",
    input: z.void(),
    output: z.void(),
  }),

  getBranchConnectionUri: defineContract({
    channel: "neon:get-branch-connection-uri",
    input: GetNeonBranchConnectionUriParamsSchema,
    output: GetNeonBranchConnectionUriResponseSchema,
  }),
} as const;

// =============================================================================
// Neon Client
// =============================================================================

export const neonClient = createClient(neonContracts);

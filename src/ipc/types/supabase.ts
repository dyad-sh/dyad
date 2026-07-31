import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Supabase Schemas
// =============================================================================

export const SupabaseOrganizationInfoSchema = z.object({
  organizationSlug: z.string(),
  name: z.string().optional(),
  ownerEmail: z.string().optional(),
});

export type SupabaseOrganizationInfo = z.infer<
  typeof SupabaseOrganizationInfoSchema
>;

export const SupabaseProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  organizationSlug: z.string(),
});

export type SupabaseProject = z.infer<typeof SupabaseProjectSchema>;

export const SupabaseBranchSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  projectRef: z.string(),
  parentProjectRef: z.string().nullable(),
});

export type SupabaseBranch = z.infer<typeof SupabaseBranchSchema>;

export const DeleteSupabaseOrganizationParamsSchema = z.object({
  organizationSlug: z.string(),
});

export type DeleteSupabaseOrganizationParams = z.infer<
  typeof DeleteSupabaseOrganizationParamsSchema
>;

export const ListSupabaseBranchesParamsSchema = z.object({
  projectId: z.string(),
  organizationSlug: z.string().nullable().optional(),
});

export const GetSupabaseEdgeLogsParamsSchema = z.object({
  projectId: z.string(),
  timestampStart: z.number().optional(),
  appId: z.number(),
  organizationSlug: z.string().nullable(),
});

export const ConsoleEntrySchema = z.object({
  level: z.enum(["info", "warn", "error"]),
  type: z.enum(["server", "client", "edge-function", "network-requests"]),
  message: z.string(),
  timestamp: z.number(),
  sourceName: z.string().optional(),
  appId: z.number(),
});

export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;

export const SetSupabaseAppProjectParamsSchema = z.object({
  appId: z.number(),
  projectId: z.string().nullable().optional(),
  parentProjectId: z.string().nullable().optional(),
  organizationSlug: z.string().nullable().optional(),
});

export type SetSupabaseAppProjectParams = z.infer<
  typeof SetSupabaseAppProjectParamsSchema
>;

// =============================================================================
// Supabase Contracts
// =============================================================================

export const supabaseContracts = {
  listOrganizations: defineContract({
    channel: "supabase:list-organizations",
    input: z.void(),
    output: z.array(SupabaseOrganizationInfoSchema),
  }),

  deleteOrganization: defineContract({
    channel: "supabase:delete-organization",
    input: DeleteSupabaseOrganizationParamsSchema,
    output: z.void(),
  }),

  listAllProjects: defineContract({
    channel: "supabase:list-all-projects",
    input: z.void(),
    output: z.array(SupabaseProjectSchema),
  }),

  listBranches: defineContract({
    channel: "supabase:list-branches",
    input: ListSupabaseBranchesParamsSchema,
    output: z.array(SupabaseBranchSchema),
  }),

  getEdgeLogs: defineContract({
    channel: "supabase:get-edge-logs",
    input: GetSupabaseEdgeLogsParamsSchema,
    output: z.array(ConsoleEntrySchema),
  }),

  setAppProject: defineContract({
    channel: "supabase:set-app-project",
    input: SetSupabaseAppProjectParamsSchema,
    output: z.void(),
  }),

  unsetAppProject: defineContract({
    channel: "supabase:unset-app-project",
    input: z.object({ app: z.number() }),
    output: z.void(),
  }),

  /**
   * Whether the app's generated Supabase client still authenticates with the
   * project's legacy `anon` key AND a publishable key exists to replace it.
   * False when there's nothing to offer, including when the app isn't
   * connected to Supabase — checking is never an error.
   */
  detectLegacyAppKey: defineContract({
    channel: "supabase:detect-legacy-app-key",
    input: z.object({ appId: z.number() }),
    output: z.object({ hasLegacyKey: z.boolean() }),
  }),

  /**
   * Rewrite the app's generated Supabase client to use the project's
   * publishable key instead of the legacy `anon` key it was generated with.
   * `updated` is false when there was nothing to switch.
   */
  switchAppToPublishableKey: defineContract({
    channel: "supabase:switch-app-to-publishable-key",
    input: z.object({ appId: z.number() }),
    output: z.object({ updated: z.boolean() }),
  }),

  // Test-only channel
  fakeConnectAndSetProject: defineContract({
    channel: "supabase:fake-connect-and-set-project",
    input: z.object({
      appId: z.number(),
      fakeProjectId: z.string(),
    }),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Supabase Client
// =============================================================================

export const supabaseClient = createClient(supabaseContracts);

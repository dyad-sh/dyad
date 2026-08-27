import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

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

export const SupabaseRedeployProgressSchema = z.object({
  appId: z.number().int().positive(),
  operationId: z.string().min(1).max(256),
  phase: z.enum(["deploying", "finished", "failed"]),
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  functionName: z.string().optional(),
});

export type SupabaseRedeployProgress = z.infer<
  typeof SupabaseRedeployProgressSchema
>;

/**
 * Regions offered in the create-project picker. Hard-coded because the
 * Management API has no endpoint that lists them. Supabase stays the authority
 * on what is actually valid — see `SupabaseRegionSchema` — so a stale list only
 * means a newly added region is missing from the dropdown.
 */
export const SUPABASE_REGIONS = [
  { id: "us-east-1", label: "East US (North Virginia)" },
  { id: "us-east-2", label: "East US (Ohio)" },
  { id: "us-west-1", label: "West US (North California)" },
  { id: "us-west-2", label: "West US (Oregon)" },
  { id: "ca-central-1", label: "Canada (Central)" },
  { id: "sa-east-1", label: "South America (Sao Paulo)" },
  { id: "eu-west-1", label: "West EU (Ireland)" },
  { id: "eu-west-2", label: "West EU (London)" },
  { id: "eu-west-3", label: "West EU (Paris)" },
  { id: "eu-central-1", label: "Central EU (Frankfurt)" },
  { id: "eu-central-2", label: "Central EU (Zurich)" },
  { id: "eu-north-1", label: "North EU (Stockholm)" },
  { id: "ap-south-1", label: "South Asia (Mumbai)" },
  { id: "ap-southeast-1", label: "Southeast Asia (Singapore)" },
  { id: "ap-northeast-1", label: "Northeast Asia (Tokyo)" },
  { id: "ap-northeast-2", label: "Northeast Asia (Seoul)" },
  { id: "ap-southeast-2", label: "Oceania (Sydney)" },
  { id: "ap-east-1", label: "East Asia (Hong Kong)" },
] as const;

export const DEFAULT_SUPABASE_REGION = "us-east-1";

export type SupabaseRegionId = (typeof SUPABASE_REGIONS)[number]["id"];

/**
 * Deliberately not an enum over `SUPABASE_REGIONS`: that would make the local
 * list a second gate, so a region Supabase added would be rejected here before
 * it could ever be sent. Supabase rejects a bad region with an explanation the
 * create path already surfaces.
 */
export const SupabaseRegionSchema = z.string().min(1);

export const CreateSupabaseProjectParamsSchema = z.object({
  appId: z.number(),
  name: z.string().min(1).max(64),
  organizationSlug: z.string().min(1),
  region: SupabaseRegionSchema,
});

export type CreateSupabaseProjectParams = z.infer<
  typeof CreateSupabaseProjectParamsSchema
>;

/**
 * One of the ~15 project statuses in Supabase's Management API (see the
 * `V1ProjectResponse` union in `@dyad-sh/supabase-management-js`). A project
 * reports this for a minute or two after creation, while its database still
 * refuses connections.
 */
export const SUPABASE_PROJECT_STATUS_PROVISIONING = "COMING_UP";

export const SupabaseProjectStatusSchema = z.object({
  projectId: z.string(),
  // Supabase's raw status, passed through rather than mapped so callers pick
  // the ones they care about. Null when the response omitted it, which is
  // distinct from Supabase reporting its own "UNKNOWN".
  status: z.string().nullable(),
});

export type SupabaseProjectStatus = z.infer<typeof SupabaseProjectStatusSchema>;

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

  /**
   * Creating and linking are one contract on purpose: a project created but not
   * linked would be an orphan the user has to clean up in the dashboard, which
   * is the trip this feature exists to avoid.
   */
  createProject: defineContract({
    channel: "supabase:create-project",
    input: CreateSupabaseProjectParamsSchema,
    output: SupabaseProjectSchema,
    // The mutation's onSuccess refreshes only the window that fired it, and the
    // same app can be open in another. `apps` as well as `app` because the list
    // decides which provider connector a window renders.
    invalidates: (input) => [
      { family: "apps" },
      { family: "app", appId: input.appId },
    ],
  }),

  /**
   * Provisioning status of a project, used to poll a just-created one until its
   * database accepts connections.
   */
  getProjectStatus: defineContract({
    channel: "supabase:get-project-status",
    input: z.object({
      projectId: z.string(),
      organizationSlug: z.string().nullable().optional(),
    }),
    output: SupabaseProjectStatusSchema,
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

  // Same scopes as createProject and the Neon equivalents: these repoint an
  // app's provider too, and a peer window that misses it keeps offering the
  // other provider for an app that now has one.
  setAppProject: defineContract({
    channel: "supabase:set-app-project",
    input: SetSupabaseAppProjectParamsSchema,
    output: z.void(),
    invalidates: (input) => [
      { family: "apps" },
      { family: "app", appId: input.appId },
    ],
  }),

  unsetAppProject: defineContract({
    channel: "supabase:unset-app-project",
    input: z.object({ app: z.number() }),
    output: z.void(),
    invalidates: (input) => [
      { family: "apps" },
      { family: "app", appId: input.app },
    ],
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
   *
   * `outcome` distinguishes a successful switch from an app that was already
   * migrated and from one the switch can't act on at all, so the UI never tells
   * a user their key is current when it is still legacy.
   *
   * Declares `invalidates` because the handler rewrites a file and may commit
   * it: the mutation's own `onSuccess` refreshes only the window that fired it,
   * and Dyad can have the same app open in another.
   */
  switchAppToPublishableKey: defineContract({
    channel: "supabase:switch-app-to-publishable-key",
    input: z.object({ appId: z.number() }),
    output: z.object({
      outcome: z.enum(["switched", "already-current", "not-applicable"]),
    }),
    invalidates: (input) => [
      { family: "versions", appId: input.appId },
      { family: "uncommitted-files", appId: input.appId },
    ],
  }),

  redeployAllFunctions: defineContract({
    channel: "supabase:redeploy-all-functions",
    input: z.object({
      appId: z.number().int().positive(),
      operationId: z.string().min(1).max(256),
    }),
    output: z.object({
      functionCount: z.number().int().nonnegative(),
      prunedFunctionNames: z.array(z.string()),
      errors: z.array(z.string()),
    }),
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

export const supabaseEvents = {
  redeployProgress: defineEvent({
    channel: "supabase:redeploy-progress",
    payload: SupabaseRedeployProgressSchema,
  }),
} as const;

// =============================================================================
// Supabase Client
// =============================================================================

export const supabaseClient = createClient(supabaseContracts);
export const supabaseEventClient = createEventClient(supabaseEvents);

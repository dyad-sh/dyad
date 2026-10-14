import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Cloudflare Schemas
// =============================================================================

export const CloudflareAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type CloudflareAccount = z.infer<typeof CloudflareAccountSchema>;

export const CloudflareWorkerSchema = z.object({
  name: z.string(),
});

export type CloudflareWorkerSummary = z.infer<typeof CloudflareWorkerSchema>;

/**
 * A folder of the app that can be deployed as a Worker: one with a Wrangler
 * config, or a Nitro app, whose build produces the Worker itself.
 */
export const CloudflareTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("wrangler"),
    /** Path from the repository root, "" for the root itself. */
    rootDirectory: z.string(),
    configPath: z.string(),
    /** Also a Nitro app, which merges the config into the one it generates. */
    nitro: z.boolean(),
    label: z.string(),
    suggestedWorkerName: z.string(),
  }),
  z.object({
    kind: z.literal("nitro"),
    rootDirectory: z.string(),
    label: z.string(),
    suggestedWorkerName: z.string(),
  }),
]);

export type CloudflareTargetSummary = z.infer<typeof CloudflareTargetSchema>;

export const CloudflareConnectionSchema = z.object({
  rootDirectory: z.string(),
  accountId: z.string(),
  workerName: z.string(),
  /** Null when the Worker is not served at a workers.dev address. */
  workerUrl: z.string().nullable(),
  dashboardUrl: z.string(),
});

export type CloudflareConnection = z.infer<typeof CloudflareConnectionSchema>;

export const CloudflareAppStatusSchema = z.object({
  /**
   * Whether the latest commit has reached GitHub. Cloudflare builds what is on
   * GitHub, so an unsynced app would deploy stale code or none at all.
   */
  synced: z.boolean(),
  branch: z.string(),
  targets: z.array(CloudflareTargetSchema),
  connections: z.array(CloudflareConnectionSchema),
});

export type CloudflareAppStatus = z.infer<typeof CloudflareAppStatusSchema>;

export const CloudflareDeploymentStateSchema = z.enum([
  "none",
  "queued",
  "building",
  "live",
  "failed",
  "cancelled",
]);

export const CloudflareDeploymentStatusSchema = z.object({
  state: CloudflareDeploymentStateSchema,
  commitHash: z.string().nullable(),
  /** The end of the build log, only when the build failed. */
  logTail: z.array(z.string()),
  /** The API token behind the deploy rule was deleted or rolled. */
  tokenRevoked: z.boolean(),
  /**
   * The deploy rule is gone from Cloudflare, so pushes no longer deploy this
   * folder whatever the last build says.
   */
  ruleMissing: z.boolean(),
  /**
   * What the rule deploys, when that is no longer the repository, branch and
   * folder the app syncs. Null when it matches.
   */
  ruleDeploys: z.string().nullable(),
  /**
   * The Worker's workers.dev address as of this check, since the route can be
   * turned on or off after connecting. Null when it is off.
   */
  workerUrl: z.string().nullable(),
});

export type CloudflareDeploymentStatus = z.infer<
  typeof CloudflareDeploymentStatusSchema
>;

/**
 * The account id goes into the path of every Cloudflare request, which carries
 * the user's token, so nothing but Cloudflare's own id format is let through.
 */
const CloudflareAccountIdSchema = z
  .string()
  .regex(/^[a-f0-9]{32}$/i, "Invalid Cloudflare account id");

export const SaveCloudflareTokenParamsSchema = z.object({
  token: z.string(),
});

export const CloudflareAppParamsSchema = z.object({
  appId: z.number(),
});

export const CloudflareAccountParamsSchema = z.object({
  accountId: CloudflareAccountIdSchema,
});

export const CheckCloudflareRepoAccessParamsSchema = z.object({
  appId: z.number(),
  accountId: CloudflareAccountIdSchema,
});

export const CloudflareTargetParamsSchema = z.object({
  appId: z.number(),
  rootDirectory: z.string(),
});

export const ConnectCloudflareWorkerParamsSchema = z.object({
  appId: z.number(),
  accountId: CloudflareAccountIdSchema,
  rootDirectory: z.string(),
  workerName: z.string(),
  /** Whether `workerName` is a Worker to create or one that already exists. */
  mode: z.enum(["create", "existing"]),
  /** Replace a deploy rule that points the Worker at a different repository. */
  overwrite: z.boolean().optional(),
});

export type ConnectCloudflareWorkerParams = z.infer<
  typeof ConnectCloudflareWorkerParamsSchema
>;

export const ConnectCloudflareWorkerResultSchema = z.discriminatedUnion(
  "status",
  [
    z.object({
      status: z.literal("connected"),
      connection: CloudflareConnectionSchema,
      /**
       * Set when the Worker is connected but something after that did not
       * go through: the first build did not start, or the app's Neon
       * configuration could not be put on the Worker.
       */
      warning: z.string().optional(),
    }),
    z.object({
      status: z.literal("conflict"),
      /** The repository the Worker currently deploys from. */
      existingRepo: z.string(),
    }),
  ],
);

export type ConnectCloudflareWorkerResult = z.infer<
  typeof ConnectCloudflareWorkerResultSchema
>;

// --- Neon → Cloudflare sync ---

export const SyncCloudflareNeonConfigParamsSchema = z.object({
  appId: z.number(),
  /**
   * The branch the Database section is showing. Without it the stored
   * deploy-branch choice is used, production when there is none.
   */
  branchType: z.enum(["production", "development"]).optional(),
});

export const CloudflareNeonSyncResultSchema = z.object({
  /** Whether every connected Worker got the secrets. */
  envPushed: z.boolean(),
  domainsAdded: z.array(z.string()),
  skipped: z.array(z.string()),
  warning: z.string().optional(),
});

export type CloudflareNeonSyncResult = z.infer<
  typeof CloudflareNeonSyncResultSchema
>;

export const RemoveNeonEnvVarsFromCloudflareResultSchema = z.object({
  removedKeys: z.array(z.string()),
  warning: z.string().optional(),
});

// =============================================================================
// Cloudflare Contracts
// =============================================================================

export const cloudflareContracts = {
  saveToken: defineContract({
    channel: "cloudflare:save-token",
    input: SaveCloudflareTokenParamsSchema,
    output: z.void(),
  }),

  listAccounts: defineContract({
    channel: "cloudflare:list-accounts",
    input: z.void(),
    output: z.array(CloudflareAccountSchema),
  }),

  listWorkers: defineContract({
    channel: "cloudflare:list-workers",
    input: CloudflareAccountParamsSchema,
    output: z.array(CloudflareWorkerSchema),
  }),

  getAppStatus: defineContract({
    channel: "cloudflare:get-app-status",
    input: CloudflareAppParamsSchema,
    output: CloudflareAppStatusSchema,
  }),

  checkRepoAccess: defineContract({
    channel: "cloudflare:check-repo-access",
    input: CheckCloudflareRepoAccessParamsSchema,
    output: z.object({ hasAccess: z.boolean() }),
  }),

  connectWorker: defineContract({
    channel: "cloudflare:connect-worker",
    input: ConnectCloudflareWorkerParamsSchema,
    output: ConnectCloudflareWorkerResultSchema,
    // The app record carries which destinations it is connected to. A
    // conflict writes nothing, so there is nothing to refresh.
    invalidates: (input, output) =>
      output.status === "connected"
        ? [{ family: "app", appId: input.appId }]
        : [],
  }),

  getDeploymentStatus: defineContract({
    channel: "cloudflare:get-deployment-status",
    input: CloudflareTargetParamsSchema,
    output: CloudflareDeploymentStatusSchema,
  }),

  disconnect: defineContract({
    channel: "cloudflare:disconnect",
    input: CloudflareTargetParamsSchema,
    output: z.void(),
    invalidates: (input) => [{ family: "app", appId: input.appId }],
  }),

  syncNeonConfig: defineContract({
    channel: "cloudflare:sync-neon-config",
    input: SyncCloudflareNeonConfigParamsSchema,
    output: CloudflareNeonSyncResultSchema,
  }),

  removeNeonEnvVars: defineContract({
    channel: "cloudflare:remove-neon-env-vars",
    input: CloudflareAppParamsSchema,
    output: RemoveNeonEnvVarsFromCloudflareResultSchema,
  }),
} as const;

// =============================================================================
// Cloudflare Client
// =============================================================================

export const cloudflareClient = createClient(cloudflareContracts);

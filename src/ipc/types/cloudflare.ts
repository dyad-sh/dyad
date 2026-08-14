import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";
import { ProposedSchemaSchema } from "../../lib/data_sources/d1_schema_design";

/**
 * Contracts for the Cloudflare D1 data source provider.
 *
 * Detection only, at this stage: what is on the machine and whether Cloudflare
 * is already authenticated. Nothing here installs, provisions or authenticates,
 * so nothing here can change the user's machine or account.
 *
 * No credential appears in any output schema. The renderer learns that a token
 * exists, never what it is.
 */

export const CloudflareEnvironmentSchema = z.object({
  platform: z.string(),
  arch: z.string(),
  nodeVersion: z.string().nullable(),
  packageManager: z.enum(["npm", "pnpm", "yarn", "bun"]),
  wranglerVersion: z.string().nullable(),
  account: z
    .object({
      email: z.string().nullable(),
      accountId: z.string().nullable(),
    })
    .nullable(),
  hasApiToken: z.boolean(),
});

export type CloudflareEnvironment = z.infer<typeof CloudflareEnvironmentSchema>;

export const CloudflareD1DatabaseSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  /** Cloudflare reports this only for some plans. */
  fileSizeBytes: z.number().nullable(),
});

export type CloudflareD1Database = z.infer<typeof CloudflareD1DatabaseSchema>;

export const cloudflareContracts = {
  /** Inspect the machine. Changes nothing. */
  detectEnvironment: defineContract({
    channel: "cloudflare:detect-environment",
    input: z.void(),
    output: CloudflareEnvironmentSchema,
  }),
  /**
   * Every D1 database the token can see, across every account it can reach.
   *
   * Takes the token as an argument rather than reading a stored one: this runs
   * before anything is saved, which is the point at which the user is deciding
   * whether to save it at all.
   */
  /**
   * Whether we already know how to reach Cloudflare.
   *
   * Asked before anything is offered, so a user who signed in last week is
   * not asked to sign in again.
   */
  authState: defineContract({
    channel: "cloudflare:auth-state",
    input: z.void(),
    output: z.object({
      /** Wrangler holds a browser sign-in. */
      signedIn: z.boolean(),
      email: z.string().nullable(),
      accountId: z.string().nullable(),
      /** A token is stored. Its value never leaves the main process. */
      hasStoredToken: z.boolean(),
    }),
  }),
  /** Remember an API token, encrypted, so it is not asked for again. */
  saveApiToken: defineContract({
    channel: "cloudflare:save-api-token",
    input: z.object({ apiToken: z.string().min(1) }),
    output: z.void(),
  }),
  /** Forget both the stored token and the browser sign-in. */
  signOut: defineContract({
    channel: "cloudflare:sign-out",
    input: z.void(),
    output: z.void(),
  }),

  /** Install Wrangler if the machine does not already have a usable one. */
  ensureWrangler: defineContract({
    channel: "cloudflare:ensure-wrangler",
    input: z.void(),
    output: z.object({ version: z.string() }),
  }),
  /** Sign in through the browser. Resolves once Cloudflare confirms who we are. */
  loginWithBrowser: defineContract({
    channel: "cloudflare:login",
    input: z.void(),
    output: z.object({
      email: z.string().nullable(),
      accountId: z.string().nullable(),
    }),
  }),
  /** D1 databases visible to the signed-in account. */
  listSignedInDatabases: defineContract({
    channel: "cloudflare:list-signed-in-databases",
    input: z.void(),
    output: z.array(z.object({ uuid: z.string(), name: z.string() })),
  }),

  /**
   * Creates a database and returns it.
   *
   * The token and account are optional: without them the signed-in Wrangler
   * does the work, which is the browser path.
   */
  createDatabase: defineContract({
    channel: "cloudflare:create-database",
    input: z.object({
      name: z.string().min(1),
      apiToken: z.string().optional(),
      accountId: z.string().optional(),
    }),
    output: z.object({
      uuid: z.string(),
      name: z.string(),
      accountId: z.string().nullable(),
    }),
  }),

  /**
   * Design a database from a description.
   *
   * Returns a structure, never SQL. The application writes the statements from
   * that structure, so nothing the model produces is executed.
   */
  designSchema: defineContract({
    channel: "cloudflare:design-schema",
    input: z.object({ description: z.string().min(3).max(4000) }),
    output: ProposedSchemaSchema,
  }),
  /**
   * Create the approved tables in a database.
   *
   * Separate from every read path and reached only after the user has seen the
   * design, because this is the one Cloudflare call here that writes.
   */
  applySchema: defineContract({
    channel: "cloudflare:apply-schema",
    input: z.object({
      databaseId: z.string().min(1),
      schema: ProposedSchemaSchema,
    }),
    output: z.object({ tablesCreated: z.number() }),
  }),

  listDatabases: defineContract({
    channel: "cloudflare:list-databases",
    // Empty means "use the remembered token", so the renderer can list without
    // ever holding the secret itself.
    input: z.object({ apiToken: z.string() }),
    output: z.array(CloudflareD1DatabaseSchema),
  }),
} as const;

export const cloudflareClient = createClient(cloudflareContracts);

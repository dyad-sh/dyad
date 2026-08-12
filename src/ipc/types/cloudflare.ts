import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

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

  listDatabases: defineContract({
    channel: "cloudflare:list-databases",
    input: z.object({ apiToken: z.string().min(1) }),
    output: z.array(CloudflareD1DatabaseSchema),
  }),
} as const;

export const cloudflareClient = createClient(cloudflareContracts);

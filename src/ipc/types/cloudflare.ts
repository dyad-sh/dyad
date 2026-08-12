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

export const cloudflareContracts = {
  /** Inspect the machine. Changes nothing. */
  detectEnvironment: defineContract({
    channel: "cloudflare:detect-environment",
    input: z.void(),
    output: CloudflareEnvironmentSchema,
  }),
} as const;

export const cloudflareClient = createClient(cloudflareContracts);

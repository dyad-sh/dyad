import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Helix Coding Agent (embedded Next.js app served from <repo>/aios)
// =============================================================================

export const HelixStateSchema = z.enum([
  "stopped",
  "starting",
  "running",
  "error",
]);
export type HelixState = z.infer<typeof HelixStateSchema>;

export const HelixStatusSchema = z.object({
  state: HelixStateSchema,
  /** URL of the Helix UI once the server is up. */
  url: z.string().nullish(),
  port: z.number(),
  /** Whether a Vercel AI Gateway API key is configured in settings. */
  hasGatewayKey: z.boolean(),
  /** Whether the bundled Helix app folder was found on disk. */
  appFound: z.boolean(),
  /** Resolved Helix app folder, when found. */
  appDir: z.string().nullish(),
  /** Where packaged builds expect the managed Helix copy to live. */
  managedDir: z.string(),
  error: z.string().nullish(),
  /** Tail of recent server output, for diagnostics. */
  recentOutput: z.array(z.string()),
});
export type HelixStatus = z.infer<typeof HelixStatusSchema>;

// =============================================================================
// Helix Contracts
// =============================================================================

export const helixContracts = {
  getStatus: defineContract({
    channel: "helix:get-status",
    input: z.void(),
    output: HelixStatusSchema,
  }),
  start: defineContract({
    channel: "helix:start",
    input: z.void(),
    output: HelixStatusSchema,
  }),
  stop: defineContract({
    channel: "helix:stop",
    input: z.void(),
    output: HelixStatusSchema,
  }),
} as const;

// =============================================================================
// Helix Client
// =============================================================================

export const helixClient = createClient(helixContracts);

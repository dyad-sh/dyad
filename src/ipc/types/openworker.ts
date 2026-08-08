import { z } from "zod";

import { createClient, defineContract } from "../contracts/core";

/**
 * OpenWorker runs as a managed pair: a Python agent server and its own built
 * UI, both hosted by Meta Human OS rather than launched standalone.
 */
export const OpenWorkerStatusSchema = z.object({
  state: z.enum(["stopped", "starting", "running", "error"]),
  /**
   * The URL to show. It carries a per-launch nonce, so it is only meaningful
   * to the window we hand it to.
   */
  url: z.string().nullable(),
  /** Whether the checkout is present and bootstrapped. */
  appFound: z.boolean(),
  /** Whether `.venv` exists — the Python side needs a one-time bootstrap. */
  venvReady: z.boolean(),
  /** Whether the UI has been built. */
  guiBuilt: z.boolean(),
  /** Where the checkout is expected, so setup instructions can name it. */
  appDir: z.string().nullable(),
  /** Whether a model provider key is configured for the agent. */
  hasModelKey: z.boolean(),
  error: z.string().nullable(),
  recentOutput: z.array(z.string()),
});

export type OpenWorkerStatus = z.infer<typeof OpenWorkerStatusSchema>;

export const openWorkerContracts = {
  getStatus: defineContract({
    channel: "openworker:get-status",
    input: z.void(),
    output: OpenWorkerStatusSchema,
  }),
  start: defineContract({
    channel: "openworker:start",
    input: z.void(),
    output: OpenWorkerStatusSchema,
  }),
  stop: defineContract({
    channel: "openworker:stop",
    input: z.void(),
    output: OpenWorkerStatusSchema,
  }),
} as const;

export const openWorkerClient = createClient(openWorkerContracts);

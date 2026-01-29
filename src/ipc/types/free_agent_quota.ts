import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Free Agent Quota Contracts
// =============================================================================

/**
 * Schema for free agent quota status response.
 */
export const FreeAgentQuotaStatusSchema = z.object({
  /** Number of messages used in the current 24-hour window */
  messagesUsed: z.number(),
  /** Maximum messages allowed (always 5) */
  messagesLimit: z.number(),
  /** Whether the quota has been exceeded */
  isQuotaExceeded: z.boolean(),
  /** Unix timestamp of the first message in the current window (null if no messages) */
  windowStartTime: z.number().nullable(),
  /** Unix timestamp when quota resets (null if no messages) */
  resetTime: z.number().nullable(),
  /** Hours remaining until quota resets (null if no messages) */
  hoursUntilReset: z.number().nullable(),
});

export type FreeAgentQuotaStatus = z.infer<typeof FreeAgentQuotaStatusSchema>;

/**
 * Free agent quota contracts define the IPC interface for managing
 * the 5-message-per-day quota for non-Pro users using Basic Agent mode.
 */
export const freeAgentQuotaContracts = {
  /**
   * Get current quota status for the free agent mode.
   * Returns messages used, remaining, and time until reset.
   */
  getFreeAgentQuotaStatus: defineContract({
    channel: "free-agent-quota:get-status",
    input: z.void(),
    output: FreeAgentQuotaStatusSchema,
  }),
} as const;

// =============================================================================
// Free Agent Quota Client
// =============================================================================

/**
 * Type-safe client for free agent quota IPC operations.
 *
 * @example
 * const status = await freeAgentQuotaClient.getFreeAgentQuotaStatus();
 * if (status.isQuotaExceeded) {
 *   console.log(`Quota exceeded. Resets in ${status.hoursUntilReset} hours`);
 * }
 */
export const freeAgentQuotaClient = createClient(freeAgentQuotaContracts);

// =============================================================================
// Type Exports
// =============================================================================

/** Output type for getFreeAgentQuotaStatus */
export type GetFreeAgentQuotaStatusOutput = z.infer<
  (typeof freeAgentQuotaContracts)["getFreeAgentQuotaStatus"]["output"]
>;

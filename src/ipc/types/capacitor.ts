import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Capacitor Schemas
// =============================================================================

export const AppIdParamsSchema = z.object({
  appId: z.number(),
});

// =============================================================================
// Capacitor Contracts
// =============================================================================

export const capacitorContracts = {
  isCapacitor: defineContract({
    channel: "is-capacitor",
    input: AppIdParamsSchema,
    output: z.boolean(),
  }),

  syncCapacitor: defineContract({
    channel: "sync-capacitor",
    input: AppIdParamsSchema,
    output: z.void(),
  }),

  openIos: defineContract({
    channel: "open-ios",
    input: AppIdParamsSchema,
    output: z.void(),
  }),

  openAndroid: defineContract({
    channel: "open-android",
    input: AppIdParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Capacitor Client
// =============================================================================

export const capacitorClient = createClient(capacitorContracts);

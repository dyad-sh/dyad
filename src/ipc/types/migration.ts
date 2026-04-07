import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Migration Schemas
// =============================================================================

export const MigrationPushParamsSchema = z.object({
  appId: z.number(),
  force: z.boolean().optional(),
});

export type MigrationPushParams = z.infer<typeof MigrationPushParamsSchema>;

export const MigrationPushResponseSchema = z.object({
  success: z.boolean(),
  warnings: z.array(z.string()).optional(),
  noChanges: z.boolean().optional(),
});

export type MigrationPushResponse = z.infer<typeof MigrationPushResponseSchema>;

// =============================================================================
// Migration Contracts
// =============================================================================

export const migrationContracts = {
  push: defineContract({
    channel: "migration:push",
    input: MigrationPushParamsSchema,
    output: MigrationPushResponseSchema,
  }),
} as const;

// =============================================================================
// Migration Client
// =============================================================================

export const migrationClient = createClient(migrationContracts);

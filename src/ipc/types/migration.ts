import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Migration Schemas
// =============================================================================

export const GenerateMigrationDiffParamsSchema = z.object({
  appId: z.number(),
});

export type GenerateMigrationDiffParams = z.infer<
  typeof GenerateMigrationDiffParamsSchema
>;

export const MigrationStatementSchema = z.object({
  sql: z.string(),
  type: z.enum(["create", "alter", "drop", "other"]),
});

export type MigrationStatement = z.infer<typeof MigrationStatementSchema>;

export const GenerateMigrationDiffResponseSchema = z.object({
  hasChanges: z.boolean(),
  statements: z.array(MigrationStatementSchema),
  fullSql: z.string(),
  summary: z.object({
    added: z.array(z.string()),
    altered: z.array(z.string()),
    dropped: z.array(z.string()),
  }),
  hasDestructiveChanges: z.boolean(),
  devBranchName: z.string(),
  prodBranchName: z.string(),
});

export type GenerateMigrationDiffResponse = z.infer<
  typeof GenerateMigrationDiffResponseSchema
>;

export const ApplyMigrationParamsSchema = z.object({
  appId: z.number(),
  statements: z.array(z.string()),
});

export type ApplyMigrationParams = z.infer<typeof ApplyMigrationParamsSchema>;

export const ApplyMigrationResponseSchema = z.object({
  success: z.boolean(),
  statementsExecuted: z.number(),
});

export type ApplyMigrationResponse = z.infer<
  typeof ApplyMigrationResponseSchema
>;

// =============================================================================
// Migration Contracts
// =============================================================================

export const migrationContracts = {
  generateDiff: defineContract({
    channel: "migration:generate-diff",
    input: GenerateMigrationDiffParamsSchema,
    output: GenerateMigrationDiffResponseSchema,
  }),

  apply: defineContract({
    channel: "migration:apply",
    input: ApplyMigrationParamsSchema,
    output: ApplyMigrationResponseSchema,
  }),
} as const;

// =============================================================================
// Migration Client
// =============================================================================

export const migrationClient = createClient(migrationContracts);

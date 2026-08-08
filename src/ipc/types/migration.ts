import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Migration Schemas
// =============================================================================

export const MigrationMigrateParamsSchema = z.object({
  appId: z.number(),
  migrationId: z.string().uuid(),
});

export type MigrationMigrateParams = z.infer<
  typeof MigrationMigrateParamsSchema
>;

export const MigrationMigrateResponseSchema = z.object({
  success: z.boolean(),
  noChanges: z.boolean().optional(),
});

export type MigrationMigrateResponse = z.infer<
  typeof MigrationMigrateResponseSchema
>;

export const MigrationDependenciesStatusParamsSchema = z.object({
  appId: z.number(),
});

export type MigrationDependenciesStatusParams = z.infer<
  typeof MigrationDependenciesStatusParamsSchema
>;

export const MigrationDependenciesStatusResponseSchema = z.object({
  installed: z.boolean(),
});

export type MigrationDependenciesStatusResponse = z.infer<
  typeof MigrationDependenciesStatusResponseSchema
>;

export const DestructiveStatementReasonSchema = z.enum([
  "drop_table",
  "drop_column",
  "alter_column_type",
  "truncate",
  "drop_schema",
]);

export type DestructiveStatementReason = z.infer<
  typeof DestructiveStatementReasonSchema
>;

export const DestructiveStatementSchema = z.object({
  index: z.number(),
  reason: DestructiveStatementReasonSchema,
});

export type DestructiveStatement = z.infer<typeof DestructiveStatementSchema>;

export const MigrationPreviewParamsSchema = z.object({
  appId: z.number(),
});

export type MigrationPreviewParams = z.infer<
  typeof MigrationPreviewParamsSchema
>;

export const MigrationPreviewResponseSchema = z.object({
  migrationId: z.string().uuid(),
  statements: z.array(z.string()),
  hasDataLoss: z.boolean(),
  warningReasons: z.array(DestructiveStatementReasonSchema),
  destructiveStatements: z.array(DestructiveStatementSchema),
});

export type MigrationPreviewResponse = z.infer<
  typeof MigrationPreviewResponseSchema
>;

// =============================================================================
// Migration Contracts
// =============================================================================

export const migrationContracts = {
  migrate: defineContract({
    channel: "migration:migrate",
    input: MigrationMigrateParamsSchema,
    output: MigrationMigrateResponseSchema,
  }),
  preview: defineContract({
    channel: "migration:preview",
    input: MigrationPreviewParamsSchema,
    output: MigrationPreviewResponseSchema,
  }),
  dependenciesStatus: defineContract({
    channel: "migration:dependencies-status",
    input: MigrationDependenciesStatusParamsSchema,
    output: MigrationDependenciesStatusResponseSchema,
  }),
} as const;

// =============================================================================
// Migration Client
// =============================================================================

export const migrationClient = createClient(migrationContracts);

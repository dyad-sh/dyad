import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Migration Schemas
// =============================================================================

export const MigrationPushParamsSchema = z.object({
  appId: z.number(),
});

export type MigrationPushParams = z.infer<typeof MigrationPushParamsSchema>;

export const MigrationPushResponseSchema = z.object({
  success: z.boolean(),
  noChanges: z.boolean().optional(),
});

export type MigrationPushResponse = z.infer<typeof MigrationPushResponseSchema>;

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
  statements: z.array(z.string()),
  hasDataLoss: z.boolean(),
  warnings: z.array(z.string()),
  destructiveStatements: z.array(DestructiveStatementSchema),
});

export type MigrationPreviewResponse = z.infer<
  typeof MigrationPreviewResponseSchema
>;

// =============================================================================
// Migration Contracts
// =============================================================================

export const migrationContracts = {
  push: defineContract({
    channel: "migration:push",
    input: MigrationPushParamsSchema,
    output: MigrationPushResponseSchema,
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

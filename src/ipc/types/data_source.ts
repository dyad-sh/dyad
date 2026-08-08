import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/**
 * Contracts for connected data sources.
 *
 * The output schemas are the security boundary made explicit: there is no
 * field in any of them that can carry a credential. The renderer learns
 * whether a secret is set, never what it is, so a mistake in a handler shows
 * up as a type error rather than as a leaked key.
 */

export const DataSourceEnvironmentSchema = z.enum([
  "production",
  "staging",
  "development",
  "other",
]);

export const DataSourceStatusSchema = z.enum([
  "connected",
  "connection_error",
  "auth_error",
  "syncing",
  "disabled",
  "unknown",
]);

export const DataSourceCredentialTypeSchema = z.enum([
  "secret",
  "service_role",
  "publishable",
  "anon",
]);

/** Everything the renderer is allowed to know about a data source. */
export const DataSourceSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  description: z.string(),
  projectUrl: z.string(),
  environment: DataSourceEnvironmentSchema,
  credentialType: DataSourceCredentialTypeSchema,
  accessMode: z.literal("read_only"),
  enabled: z.boolean(),
  status: DataSourceStatusSchema,
  statusMessage: z.string(),
  /** Whether a secret exists, never the secret. */
  hasCredential: z.boolean(),
  hasConnectionString: z.boolean(),
  tableCount: z.number(),
  relationshipCount: z.number(),
  lastConnectedAt: z.number().nullable(),
  lastSchemaSyncAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type DataSourceDto = z.infer<typeof DataSourceSchema>;

export const HealthCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});

export const HealthResultSchema = z.object({
  ok: z.boolean(),
  checks: z.array(HealthCheckSchema),
  tablesDiscovered: z.number().nullable(),
});

export const DataSourceTableSchema = z.object({
  id: z.string(),
  schemaName: z.string(),
  tableName: z.string(),
  tableType: z.string(),
  description: z.string(),
  semanticDescription: z.string(),
  estimatedRows: z.number().nullable(),
  columns: z.array(
    z.object({
      columnName: z.string(),
      dataType: z.string(),
      nullable: z.boolean(),
      primaryKey: z.boolean(),
      isUnique: z.boolean(),
      description: z.string(),
    }),
  ),
});

export const DataSourceCatalogueSchema = z.object({
  tables: z.array(DataSourceTableSchema),
  relationships: z.array(
    z.object({
      sourceSchema: z.string(),
      sourceTable: z.string(),
      sourceColumn: z.string(),
      targetSchema: z.string(),
      targetTable: z.string(),
      targetColumn: z.string(),
    }),
  ),
});

/**
 * Secrets on the way in.
 *
 * `undefined` leaves an existing secret untouched, `""` clears it, and a value
 * replaces it. That three-state convention is what lets someone rename a
 * source without wiping its credential, and it is copied from how the agent
 * cards already behave so the two forms cannot drift apart.
 */
const SecretInput = z.string().optional();

export const dataSourceContracts = {
  list: defineContract({
    channel: "data-source:list",
    input: z.void(),
    output: z.array(DataSourceSchema),
  }),
  get: defineContract({
    channel: "data-source:get",
    input: z.object({ id: z.string() }),
    output: DataSourceSchema.nullable(),
  }),
  create: defineContract({
    channel: "data-source:create",
    input: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      projectUrl: z.string().min(1),
      environment: DataSourceEnvironmentSchema,
      credentialType: DataSourceCredentialTypeSchema,
      apiKey: SecretInput,
      connectionString: SecretInput,
    }),
    output: DataSourceSchema,
  }),
  update: defineContract({
    channel: "data-source:update",
    input: z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      projectUrl: z.string().min(1).optional(),
      environment: DataSourceEnvironmentSchema.optional(),
      credentialType: DataSourceCredentialTypeSchema.optional(),
      enabled: z.boolean().optional(),
      apiKey: SecretInput,
      connectionString: SecretInput,
    }),
    output: DataSourceSchema,
  }),
  /** Tests a saved source, or an unsaved form before it is committed. */
  test: defineContract({
    channel: "data-source:test",
    input: z.object({
      id: z.string().optional(),
      projectUrl: z.string().optional(),
      apiKey: SecretInput,
      connectionString: SecretInput,
    }),
    output: HealthResultSchema,
  }),
  syncSchema: defineContract({
    channel: "data-source:sync-schema",
    input: z.object({ id: z.string() }),
    output: z.object({
      dataSource: DataSourceSchema,
      tables: z.number(),
      columns: z.number(),
      relationships: z.number(),
    }),
  }),
  catalogue: defineContract({
    channel: "data-source:catalogue",
    input: z.object({ id: z.string() }),
    output: DataSourceCatalogueSchema,
  }),
  delete: defineContract({
    channel: "data-source:delete",
    input: z.object({ id: z.string() }),
    output: z.object({ deleted: z.boolean() }),
  }),
};

export const dataSourceClient = createClient(dataSourceContracts);

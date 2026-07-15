import {
  withDatabaseClient,
  type DatabaseConnectionOptions,
  type DatabaseClient,
} from "./db/connect.js";
import { getSchema, type GetSchemaOptions } from "./db/introspect.js";
import {
  buildSchemaSnapshotSql,
  getSchemaFromSnapshot,
} from "./db/snapshot.js";
import {
  generatePlan,
  toSchemaDiffResult,
  type GeneratePlanOptions,
} from "./plan/generate.js";
import type { SchemaDiffResult, SchemaDiffStatement } from "./plan/types.js";
import { PgSchemaDiffError } from "./errors.js";
import { emptySchema, type Schema } from "./schema/model.js";
import {
  filterSchemaForTable,
  missingPublicTableComment,
  renderSchemaSql,
  type FilterSchemaForTableOptions,
  type RenderSchemaSqlOptions,
} from "./render/schemaSql.js";

export {
  DuplicateIdentifierError,
  NotImplementedMigrationError,
  PgSchemaDiffError,
  UnsupportedPostgresVersionError,
} from "./errors.js";

export type GenerateSchemaDiffOptions = {
  readonly currentDatabaseUrl: string;
  readonly desiredDatabaseUrl: string;
  readonly includeSchemas?: readonly string[];
  readonly excludeSchemas?: readonly string[];
  readonly noConcurrentIndexOperations?: boolean;
  readonly connection?: DatabaseConnectionOptions;
};

export type {
  DatabaseClient,
  DatabaseConnectionOptions,
  FilterSchemaForTableOptions,
  GetSchemaOptions,
  RenderSchemaSqlOptions,
  Schema,
  SchemaDiffResult,
  SchemaDiffStatement,
};

export {
  emptySchema,
  filterSchemaForTable,
  missingPublicTableComment,
  buildSchemaSnapshotSql,
  getSchema,
  getSchemaFromSnapshot,
  renderSchemaSql,
  withDatabaseClient,
};

export async function generateSchemaDiff(
  options: GenerateSchemaDiffOptions,
): Promise<SchemaDiffResult> {
  const [currentSchema, desiredSchema] = await Promise.all([
    readSchema("current", options.currentDatabaseUrl, options),
    readSchema("desired", options.desiredDatabaseUrl, options),
  ]);

  const planOptions: GeneratePlanOptions =
    options.noConcurrentIndexOperations === undefined
      ? {}
      : { noConcurrentIndexOperations: options.noConcurrentIndexOperations };
  return toSchemaDiffResult(
    generatePlan(currentSchema, desiredSchema, planOptions),
  );
}

async function readSchema(
  label: "current" | "desired",
  databaseUrl: string,
  options: GenerateSchemaDiffOptions,
) {
  try {
    return await withDatabaseClient(
      databaseUrl,
      options.connection ?? {},
      (client) => getSchema(client, options),
    );
  } catch (error) {
    throw new PgSchemaDiffError(
      `Failed to introspect ${label} database schema`,
      { cause: error },
    );
  }
}

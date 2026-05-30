import {
  withDatabaseClient,
  type DatabaseConnectionOptions,
} from "./db/connect.js";
import { getSchema } from "./db/introspect.js";
import {
  generatePlan,
  toSchemaDiffResult,
  type GeneratePlanOptions,
} from "./plan/generate.js";
import type { SchemaDiffResult, SchemaDiffStatement } from "./plan/types.js";
import { PgSchemaDiffError } from "./errors.js";

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
  readonly rejectEnumValueUsageInSameTransaction?: boolean;
  readonly connection?: DatabaseConnectionOptions;
};

export type {
  DatabaseConnectionOptions,
  SchemaDiffResult,
  SchemaDiffStatement,
};

export async function generateSchemaDiff(
  options: GenerateSchemaDiffOptions,
): Promise<SchemaDiffResult> {
  const [currentSchema, desiredSchema] = await Promise.all([
    readSchema("current", options.currentDatabaseUrl, options),
    readSchema("desired", options.desiredDatabaseUrl, options),
  ]);

  const planOptions: GeneratePlanOptions = {
    ...(options.noConcurrentIndexOperations === undefined
      ? {}
      : { noConcurrentIndexOperations: options.noConcurrentIndexOperations }),
    ...(options.rejectEnumValueUsageInSameTransaction === undefined
      ? {}
      : {
          rejectEnumValueUsageInSameTransaction:
            options.rejectEnumValueUsageInSameTransaction,
        }),
  };
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

import { generatePlan } from "../plan/generate.js";
import { escapeIdentifier, fqName } from "../schema/identifiers.js";
import {
  emptySchema,
  type CheckConstraint,
  type FunctionSchema,
  type Schema,
  type SchemaQualifiedName,
  type Table,
} from "../schema/model.js";

export type RenderSchemaSqlOptions = {
  readonly noConcurrentIndexOperations?: boolean;
  readonly emptySchemaComment?: string;
};

export type FilterSchemaForTableOptions = {
  readonly schemaName?: string;
  readonly tableName: string;
};

export function renderSchemaSql(
  schema: Schema,
  options: RenderSchemaSqlOptions = {},
): string {
  const deferredChecks: { table: Table; constraint: CheckConstraint }[] = [];
  const omittedComments: string[] = [];
  const renderableSchema: Schema = {
    ...schema,
    tables: schema.tables.map((table) => {
      for (const constraint of table.checkConstraints) {
        if (constraint.dependsOnFunctions.length > 0) {
          deferredChecks.push({ table, constraint });
        }
      }
      if (table.replicaIdentity === "i") {
        omittedComments.push(
          `-- Replica identity using an index is configured on ${fqName(table.name)}; the index identity is not available from introspection.`,
        );
      }
      return {
        ...table,
        checkConstraints: table.checkConstraints.filter(
          (constraint) => constraint.dependsOnFunctions.length === 0,
        ),
        replicaIdentity:
          table.replicaIdentity === "i" ? "d" : table.replicaIdentity,
      };
    }),
    indexes: schema.indexes.filter((index) => {
      if (!index.isInvalid) {
        return true;
      }
      omittedComments.push(
        `-- Invalid index ${escapeIdentifier(index.name)} on ${fqName(index.owningRelName)} cannot be recreated and was omitted.`,
      );
      return false;
    }),
  };
  const plan = generatePlan(emptySchema(), renderableSchema, {
    noConcurrentIndexOperations: options.noConcurrentIndexOperations ?? true,
    schemaRendering: true,
  });
  const statements = [
    ...plan.statements.map((statement) => terminateSqlStatement(statement.sql)),
    ...deferredChecks.map(({ table, constraint }) =>
      renderFunctionBackedCheckConstraint(table, constraint),
    ),
    ...omittedComments,
  ];
  if (statements.length === 0) {
    return options.emptySchemaComment ?? "-- No schema objects found.";
  }
  return statements.join("\n\n");
}

function renderFunctionBackedCheckConstraint(
  table: Table,
  constraint: CheckConstraint,
): string {
  let sql = `ALTER TABLE ${fqName(table.name)} ADD CONSTRAINT ${escapeIdentifier(constraint.name)} CHECK(${constraint.expression})`;
  if (!constraint.isInheritable) {
    sql += " NO INHERIT";
  }
  if (!constraint.isValid) {
    sql += " NOT VALID";
  }
  return terminateSqlStatement(sql);
}

export function filterSchemaForTable(
  schema: Schema,
  options: FilterSchemaForTableOptions,
): Schema {
  const schemaName = options.schemaName ?? "public";
  const selectedTableName = {
    schemaName,
    escapedName: escapeIdentifier(options.tableName),
  };
  const tables = schema.tables.filter((table) =>
    sameSchemaQualifiedName(table.name, selectedTableName),
  );

  if (tables.length === 0) {
    return emptySchema();
  }

  const tableNames = new Set(tables.map((table) => fqName(table.name)));
  const triggers = schema.triggers.filter((trigger) =>
    tableNames.has(fqName(trigger.owningTable)),
  );
  const functionNames = collectRelevantFunctionNames(schema.functions, [
    ...triggers.map((trigger) => trigger.functionName),
    ...tables.flatMap((table) =>
      table.checkConstraints.flatMap(
        (constraint) => constraint.dependsOnFunctions,
      ),
    ),
  ]);

  return {
    ...emptySchema(),
    namedSchemas: schema.namedSchemas.filter(
      (namedSchema) => namedSchema.name === schemaName,
    ),
    extensions: schema.extensions.filter(
      (extension) => extension.name.schemaName === schemaName,
    ),
    // Keep all enums in the schema. Column type strings do not retain a typed
    // reference back to enum objects, so this avoids dropping enum definitions
    // needed by the selected table.
    enums: schema.enums.filter(
      (schemaEnum) => schemaEnum.name.schemaName === schemaName,
    ),
    tables,
    indexes: schema.indexes.filter((index) =>
      tableNames.has(fqName(index.owningRelName)),
    ),
    foreignKeyConstraints: schema.foreignKeyConstraints.filter((constraint) =>
      tableNames.has(fqName(constraint.owningTable)),
    ),
    // Column defaults are opaque SQL strings, so retain all sequences in the
    // schema to preserve unowned/shared nextval() dependencies.
    sequences: schema.sequences.filter(
      (sequence) => sequence.name.schemaName === schemaName,
    ),
    functions: schema.functions.filter((fn) =>
      functionNames.has(fqName(fn.name)),
    ),
    triggers,
  };
}

function terminateSqlStatement(sql: string): string {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function collectRelevantFunctionNames(
  functions: readonly FunctionSchema[],
  roots: readonly SchemaQualifiedName[],
): ReadonlySet<string> {
  const functionsByName = new Map(
    functions.map((fn) => [fqName(fn.name), fn] as const),
  );
  const names = new Set<string>();
  const stack = roots.map((name) => fqName(name));

  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined || names.has(name)) {
      continue;
    }
    names.add(name);
    const fn = functionsByName.get(name);
    if (fn === undefined) {
      continue;
    }
    for (const dependency of fn.dependsOnFunctions) {
      stack.push(fqName(dependency));
    }
  }

  return names;
}

function sameSchemaQualifiedName(
  left: SchemaQualifiedName,
  right: SchemaQualifiedName,
): boolean {
  return (
    left.schemaName === right.schemaName &&
    left.escapedName === right.escapedName
  );
}

import type { QueryResult } from "pg";
import type { DatabaseClient } from "./connect.js";
import {
  getCheckConstraintsSql,
  getColumnsForTableSql,
  getDependsOnFunctionsSql,
  getEnumsSql,
  getExtensionsSql,
  getForeignKeyConstraintsSql,
  getIndexesSql,
  getMaterializedViewsSql,
  getPoliciesSql,
  getProcsSql,
  getSchemasSql,
  getSequencesSql,
  getTablePrivilegesSql,
  getTablesSql,
  getTriggersSql,
  getViewsSql,
} from "./queries.js";
import {
  emptySchema,
  type CheckConstraint,
  type Column,
  type ColumnIdentity,
  type ForeignKeyConstraint,
  type FunctionSchema,
  type Index,
  type IndexConstraintType,
  type MaterializedView,
  type Policy,
  type PolicyCmd,
  type Procedure,
  type RelKind,
  type ReplicaIdentity,
  type Schema,
  type Sequence,
  type Table,
  type TableDependency,
  type TablePrivilege,
  type Trigger,
  type View,
  type ViewColumn,
} from "../schema/model.js";
import {
  escapeIdentifier,
  procName,
  schemaQualifiedName,
} from "../schema/identifiers.js";
import {
  PgSchemaDiffError,
  UnsupportedPostgresVersionError,
} from "../errors.js";

type SchemaRow = {
  readonly schema_name: string;
};

type EnumRow = {
  readonly enum_name: string;
  readonly enum_schema_name: string;
  readonly enum_labels: readonly string[] | null;
};

type TableRow = {
  readonly oid: string;
  readonly table_name: string;
  readonly table_schema_name: string;
  readonly replica_identity: ReplicaIdentity;
  readonly rls_enabled: boolean;
  readonly rls_forced: boolean;
  readonly parent_table_name: string;
  readonly parent_table_schema_name: string;
  readonly partition_key_def: string;
  readonly partition_for_values: string;
};

type ExtensionRow = {
  readonly oid: string;
  readonly extension_name: string;
  readonly extension_version: string;
  readonly schema_name: string;
};

type IndexRow = {
  readonly oid: string;
  readonly index_name: string;
  readonly table_name: string;
  readonly table_schema_name: string;
  readonly owning_table_relkind: RelKind;
  readonly def_stmt: string;
  readonly constraint_name: string;
  readonly constraint_type: "" | IndexConstraintType;
  readonly constraint_def: string;
  readonly index_is_valid: boolean;
  readonly index_is_pk: boolean;
  readonly index_is_unique: boolean;
  readonly parent_index_name: string;
  readonly parent_index_schema_name: string;
  readonly column_names: readonly string[] | null;
  readonly constraint_is_local: boolean;
};

type CheckConstraintRow = {
  readonly oid: string;
  readonly constraint_name: string;
  readonly column_names: readonly string[] | null;
  readonly table_name: string;
  readonly table_schema_name: string;
  readonly is_valid: boolean;
  readonly is_not_inheritable: boolean;
  readonly constraint_expression: string;
};

type ForeignKeyConstraintRow = {
  readonly constraint_name: string;
  readonly owning_table_name: string;
  readonly owning_table_schema_name: string;
  readonly foreign_table_name: string;
  readonly foreign_table_schema_name: string;
  readonly is_valid: boolean;
  readonly constraint_def: string;
};

type ProcRow = {
  readonly oid: string;
  readonly func_name: string;
  readonly func_schema_name: string;
  readonly func_lang: string;
  readonly func_identity_arguments: string;
  readonly func_result: string;
  readonly func_def: string;
};

type DependsOnFunctionRow = {
  readonly func_name: string;
  readonly func_schema_name: string;
  readonly func_identity_arguments: string;
};

type TriggerRow = {
  readonly trigger_name: string;
  readonly owning_table_name: string;
  readonly owning_table_schema_name: string;
  readonly func_name: string;
  readonly func_schema_name: string;
  readonly func_identity_arguments: string;
  readonly trigger_def: string;
  readonly is_constraint: boolean;
};

type SequenceRow = {
  readonly sequence_name: string;
  readonly sequence_schema_name: string;
  readonly owner_column_name: string;
  readonly owner_schema_name: string;
  readonly owner_table_name: string;
  readonly start_value: string;
  readonly increment_value: string;
  readonly max_value: string;
  readonly min_value: string;
  readonly cache_size: string;
  readonly is_cycle: boolean;
  readonly data_type: string;
};

type PolicyRow = {
  readonly policy_name: string;
  readonly owning_table_name: string;
  readonly owning_table_schema_name: string;
  readonly is_permissive: boolean;
  readonly applies_to: readonly string[] | null;
  readonly cmd: PolicyCmd;
  readonly check_expression: string;
  readonly using_expression: string;
  readonly column_names: readonly string[] | null;
};

type ViewRow = {
  readonly schema_name: string;
  readonly view_name: string;
  readonly rel_options: readonly string[] | null;
  readonly output_columns: readonly string[] | null;
  readonly table_dependencies: readonly string[] | null;
  readonly view_definition: string;
};

type MaterializedViewRow = ViewRow & {
  readonly tablespace_name: string;
};

type TablePrivilegeRow = {
  readonly table_name: string;
  readonly table_schema_name: string;
  readonly grantee: string;
  readonly privilege: string;
  readonly is_grantable: boolean;
};

type ColumnRow = {
  readonly column_name: string;
  readonly is_not_null: boolean;
  readonly has_missing_val_optimization: boolean;
  readonly column_size: number;
  readonly identity_type: "" | "a" | "d";
  readonly start_value: string | null;
  readonly increment_value: string | null;
  readonly max_value: string | null;
  readonly min_value: string | null;
  readonly cache_size: string | null;
  readonly is_cycle: boolean | null;
  readonly collation_name: string;
  readonly collation_schema_name: string;
  readonly default_value: string;
  readonly generation_expression: string;
  readonly is_generated: boolean;
  readonly column_type: string;
};

type ServerVersionRow = {
  readonly server_version_num: string;
};

export type GetSchemaOptions = {
  readonly includeSchemas?: readonly string[];
  readonly excludeSchemas?: readonly string[];
};

export async function getSchema(
  client: DatabaseClient,
  options: GetSchemaOptions = {},
): Promise<Schema> {
  await validateSupportedPostgresVersion(client);
  const namedSchemas = await fetchNamedSchemas(client);
  const extensions = await fetchExtensions(client);
  const enums = await fetchEnums(client);
  const tables = await fetchTables(client);
  const indexes = await fetchIndexes(client);
  const foreignKeyConstraints = await fetchForeignKeyConstraints(client);
  const sequences = await fetchSequences(client);
  const functions = await fetchFunctions(client);
  const procedures = await fetchProcedures(client);
  const triggers = await fetchTriggers(client);
  const views = await fetchViews(client);
  const materializedViews = await fetchMaterializedViews(client);
  return filterSchema(
    {
      ...emptySchema(),
      namedSchemas,
      extensions,
      enums,
      tables,
      indexes,
      foreignKeyConstraints,
      sequences,
      functions,
      procedures,
      triggers,
      views,
      materializedViews,
    },
    options,
  );
}

export async function validateSupportedPostgresVersion(
  client: DatabaseClient,
): Promise<void> {
  const result: QueryResult<ServerVersionRow> = await client.query(
    "SHOW server_version_num",
  );
  const rawVersion = result.rows[0]?.server_version_num;
  const versionNumber =
    rawVersion === undefined ? Number.NaN : Number.parseInt(rawVersion, 10);
  assertSupportedPostgresVersion(versionNumber);
}

export function assertSupportedPostgresVersion(versionNumber: number): void {
  if (!Number.isFinite(versionNumber) || versionNumber < 140_000) {
    throw new UnsupportedPostgresVersionError(versionNumber);
  }
}

async function fetchNamedSchemas(
  client: DatabaseClient,
): Promise<Schema["namedSchemas"]> {
  const result: QueryResult<SchemaRow> = await client.query(getSchemasSql);
  return result.rows.map((row) => ({
    kind: "namedSchema",
    name: row.schema_name,
  }));
}

async function fetchEnums(client: DatabaseClient): Promise<Schema["enums"]> {
  const result: QueryResult<EnumRow> = await client.query(getEnumsSql);
  return result.rows.map((row) => ({
    kind: "enum",
    name: schemaQualifiedName(row.enum_schema_name, row.enum_name),
    labels: row.enum_labels ?? [],
  }));
}

async function fetchExtensions(
  client: DatabaseClient,
): Promise<Schema["extensions"]> {
  const result: QueryResult<ExtensionRow> =
    await client.query(getExtensionsSql);
  return result.rows.map((row) => ({
    kind: "extension",
    name: schemaQualifiedName(row.schema_name, row.extension_name),
    version: row.extension_version,
  }));
}

async function fetchTables(client: DatabaseClient): Promise<Schema["tables"]> {
  const checkConstraints = await fetchCheckConstraints(client);
  const policies = await fetchPolicies(client);
  const privileges = await fetchPrivileges(client);
  const checkConstraintsByTable = groupByTable(
    checkConstraints,
    (value) => value.table,
  );
  const policiesByTable = groupByTable(policies, (value) => value.table);
  const privilegesByTable = groupByTable(privileges, (value) => value.table);

  const result: QueryResult<TableRow> = await client.query(getTablesSql);
  const tables: Table[] = [];
  for (const row of result.rows) {
    tables.push(
      await buildTable(
        client,
        row,
        checkConstraintsByTable,
        policiesByTable,
        privilegesByTable,
      ),
    );
  }
  return tables;
}

async function buildTable(
  client: DatabaseClient,
  row: TableRow,
  checkConstraintsByTable: ReadonlyMap<string, readonly CheckConstraint[]>,
  policiesByTable: ReadonlyMap<string, readonly Policy[]>,
  privilegesByTable: ReadonlyMap<string, readonly TablePrivilege[]>,
): Promise<Table> {
  const columnsResult: QueryResult<ColumnRow> = await client.query(
    getColumnsForTableSql,
    [row.oid],
  );
  const parentTable =
    row.parent_table_name.length === 0
      ? null
      : schemaQualifiedName(
          row.parent_table_schema_name,
          row.parent_table_name,
        );
  const tableName = schemaQualifiedName(row.table_schema_name, row.table_name);
  const tableKey = tableObjectKey(row.table_schema_name, row.table_name);

  return {
    kind: "table",
    name: tableName,
    columns: columnsResult.rows.map((column) => buildColumn(row, column)),
    checkConstraints: checkConstraintsByTable.get(tableKey) ?? [],
    policies: policiesByTable.get(tableKey) ?? [],
    privileges: privilegesByTable.get(tableKey) ?? [],
    replicaIdentity: row.replica_identity,
    rlsEnabled: row.rls_enabled,
    rlsForced: row.rls_forced,
    partitionKeyDef: row.partition_key_def,
    parentTable,
    forValues: row.partition_for_values,
  };
}

type CheckConstraintWithTable = {
  readonly table: string;
  readonly value: CheckConstraint;
};

type PolicyWithTable = {
  readonly table: string;
  readonly value: Policy;
};

type PrivilegeWithTable = {
  readonly table: string;
  readonly value: TablePrivilege;
};

async function fetchCheckConstraints(
  client: DatabaseClient,
): Promise<readonly CheckConstraintWithTable[]> {
  const result: QueryResult<CheckConstraintRow> = await client.query(
    getCheckConstraintsSql,
  );
  const out: CheckConstraintWithTable[] = [];
  for (const row of result.rows) {
    out.push({
      table: tableObjectKey(row.table_schema_name, row.table_name),
      value: {
        kind: "checkConstraint",
        name: row.constraint_name,
        keyColumns: row.column_names ?? [],
        expression: row.constraint_expression,
        isValid: row.is_valid,
        isInheritable: !row.is_not_inheritable,
        dependsOnFunctions: await fetchDependsOnFunctions(
          client,
          "pg_constraint",
          row.oid,
        ),
      },
    });
  }
  return out;
}

async function fetchPolicies(
  client: DatabaseClient,
): Promise<readonly PolicyWithTable[]> {
  const result: QueryResult<PolicyRow> = await client.query(getPoliciesSql);
  return result.rows.map((row) => ({
    table: tableObjectKey(row.owning_table_schema_name, row.owning_table_name),
    value: {
      kind: "policy",
      escapedName: escapeIdentifier(row.policy_name),
      isPermissive: row.is_permissive,
      appliesTo: row.applies_to ?? [],
      cmd: row.cmd,
      checkExpression: row.check_expression,
      usingExpression: row.using_expression,
      columns: row.column_names ?? [],
    },
  }));
}

async function fetchPrivileges(
  client: DatabaseClient,
): Promise<readonly PrivilegeWithTable[]> {
  const result: QueryResult<TablePrivilegeRow> = await client.query(
    getTablePrivilegesSql,
  );
  return result.rows.map((row) => ({
    table: tableObjectKey(row.table_schema_name, row.table_name),
    value: {
      kind: "tablePrivilege",
      grantee: row.grantee,
      privilege: row.privilege,
      isGrantable: row.is_grantable,
    },
  }));
}

async function fetchIndexes(client: DatabaseClient): Promise<readonly Index[]> {
  const result: QueryResult<IndexRow> = await client.query(getIndexesSql);
  return result.rows.map((row) => {
    const constraint =
      row.constraint_name.length === 0 || row.constraint_type === ""
        ? null
        : {
            type: row.constraint_type,
            escapedConstraintName: escapeIdentifier(row.constraint_name),
            constraintDef: row.constraint_def,
            isLocal: row.constraint_is_local,
          };
    return {
      kind: "index",
      name: row.index_name,
      owningRelName: schemaQualifiedName(row.table_schema_name, row.table_name),
      owningRelKind: row.owning_table_relkind,
      columns: row.column_names ?? [],
      isInvalid: !row.index_is_valid,
      isUnique: row.index_is_unique,
      constraint,
      getIndexDefStmt: row.def_stmt,
      parentIdx:
        row.parent_index_name.length === 0
          ? null
          : schemaQualifiedName(
              row.parent_index_schema_name,
              row.parent_index_name,
            ),
    };
  });
}

async function fetchForeignKeyConstraints(
  client: DatabaseClient,
): Promise<readonly ForeignKeyConstraint[]> {
  const result: QueryResult<ForeignKeyConstraintRow> = await client.query(
    getForeignKeyConstraintsSql,
  );
  return result.rows.map((row) => ({
    kind: "foreignKeyConstraint",
    escapedName: escapeIdentifier(row.constraint_name),
    owningTable: schemaQualifiedName(
      row.owning_table_schema_name,
      row.owning_table_name,
    ),
    foreignTable: schemaQualifiedName(
      row.foreign_table_schema_name,
      row.foreign_table_name,
    ),
    constraintDef: row.constraint_def,
    isValid: row.is_valid,
  }));
}

async function fetchSequences(
  client: DatabaseClient,
): Promise<readonly Sequence[]> {
  const result: QueryResult<SequenceRow> = await client.query(getSequencesSql);
  return result.rows.map((row) => ({
    kind: "sequence",
    name: schemaQualifiedName(row.sequence_schema_name, row.sequence_name),
    owner:
      row.owner_column_name.length === 0
        ? null
        : {
            tableName: schemaQualifiedName(
              row.owner_schema_name,
              row.owner_table_name,
            ),
            columnName: row.owner_column_name,
          },
    type: row.data_type,
    startValue: BigInt(row.start_value),
    increment: BigInt(row.increment_value),
    maxValue: BigInt(row.max_value),
    minValue: BigInt(row.min_value),
    cacheSize: BigInt(row.cache_size),
    cycle: row.is_cycle,
  }));
}

async function fetchFunctions(
  client: DatabaseClient,
): Promise<readonly FunctionSchema[]> {
  const result: QueryResult<ProcRow> = await client.query(getProcsSql, ["f"]);
  const functions: FunctionSchema[] = [];
  for (const row of result.rows) {
    functions.push({
      kind: "function",
      name: procName(
        row.func_schema_name,
        row.func_name,
        row.func_identity_arguments,
      ),
      functionDef: row.func_def,
      returnType: row.func_result,
      language: row.func_lang,
      dependsOnFunctions: await fetchDependsOnFunctions(
        client,
        "pg_proc",
        row.oid,
      ),
    });
  }
  return functions;
}

async function fetchProcedures(
  client: DatabaseClient,
): Promise<readonly Procedure[]> {
  const result: QueryResult<ProcRow> = await client.query(getProcsSql, ["p"]);
  return result.rows.map((row) => ({
    kind: "procedure",
    name: procName(
      row.func_schema_name,
      row.func_name,
      row.func_identity_arguments,
    ),
    def: row.func_def,
  }));
}

async function fetchDependsOnFunctions(
  client: DatabaseClient,
  systemCatalog: "pg_constraint" | "pg_proc",
  objectId: string,
): Promise<readonly FunctionSchema["name"][]> {
  const result: QueryResult<DependsOnFunctionRow> = await client.query(
    getDependsOnFunctionsSql,
    [systemCatalog, objectId],
  );
  return result.rows.map((row) =>
    procName(row.func_schema_name, row.func_name, row.func_identity_arguments),
  );
}

async function fetchTriggers(
  client: DatabaseClient,
): Promise<readonly Trigger[]> {
  const result: QueryResult<TriggerRow> = await client.query(getTriggersSql);
  return result.rows.map((row) => ({
    kind: "trigger",
    escapedName: escapeIdentifier(row.trigger_name),
    owningTable: schemaQualifiedName(
      row.owning_table_schema_name,
      row.owning_table_name,
    ),
    functionName: procName(
      row.func_schema_name,
      row.func_name,
      row.func_identity_arguments,
    ),
    getTriggerDefStmt: row.trigger_def,
    isConstraint: row.is_constraint,
  }));
}

async function fetchViews(client: DatabaseClient): Promise<readonly View[]> {
  const result: QueryResult<ViewRow> = await client.query(getViewsSql);
  return result.rows.map((row) => ({
    kind: "view",
    name: schemaQualifiedName(row.schema_name, row.view_name),
    viewDefinition: row.view_definition,
    outputColumns: parseViewColumns(row.output_columns ?? []),
    options: relOptionsToMap(row.rel_options ?? []),
    tableDependencies: parseTableDependencies(row.table_dependencies ?? []),
  }));
}

async function fetchMaterializedViews(
  client: DatabaseClient,
): Promise<readonly MaterializedView[]> {
  const result: QueryResult<MaterializedViewRow> = await client.query(
    getMaterializedViewsSql,
  );
  return result.rows.map((row) => ({
    kind: "materializedView",
    name: schemaQualifiedName(row.schema_name, row.view_name),
    viewDefinition: row.view_definition,
    outputColumns: parseViewColumns(row.output_columns ?? []),
    options: relOptionsToMap(row.rel_options ?? []),
    tablespace: row.tablespace_name,
    tableDependencies: parseTableDependencies(row.table_dependencies ?? []),
  }));
}

function relOptionsToMap(
  values: readonly string[],
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const value of values) {
    const separatorIndex = value.indexOf("=");
    if (separatorIndex < 0) {
      throw new Error(`invalid reloption: ${value}`);
    }
    out[value.slice(0, separatorIndex)] = value.slice(separatorIndex + 1);
  }
  return out;
}

function parseTableDependencies(
  values: readonly string[],
): readonly TableDependency[] {
  return values.map((value) => {
    const parsed = parseTableDependency(value);
    return {
      name: schemaQualifiedName(parsed.schema, parsed.name),
      columns: parsed.columns,
    };
  });
}

function parseViewColumns(values: readonly string[]): readonly ViewColumn[] {
  return values.map((value) => {
    const parsed: unknown = JSON.parse(value);
    if (!isViewColumnJson(parsed)) {
      throw new Error(`invalid view column JSON: ${value}`);
    }
    return parsed;
  });
}

function isViewColumnJson(value: unknown): value is ViewColumn {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly name?: unknown }).name === "string" &&
    typeof (value as { readonly type?: unknown }).type === "string"
  );
}

function parseTableDependency(value: string): {
  readonly schema: string;
  readonly name: string;
  readonly columns: readonly string[];
} {
  const parsed: unknown = JSON.parse(value);
  if (!isTableDependencyJson(parsed)) {
    throw new Error(`invalid table dependency JSON: ${value}`);
  }
  return { ...parsed, columns: parsed.columns ?? [] };
}

function isTableDependencyJson(value: unknown): value is {
  readonly schema: string;
  readonly name: string;
  readonly columns: readonly string[] | null;
} {
  const columns = (value as { readonly columns?: unknown } | null)?.columns;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly schema?: unknown }).schema === "string" &&
    typeof (value as { readonly name?: unknown }).name === "string" &&
    (columns === null ||
      (Array.isArray(columns) &&
        columns.every((column) => typeof column === "string")))
  );
}

function groupByTable<TValue>(
  values: readonly { readonly table: string; readonly value: TValue }[],
  getTable: (value: {
    readonly table: string;
    readonly value: TValue;
  }) => string,
): ReadonlyMap<string, readonly TValue[]> {
  const out = new Map<string, TValue[]>();
  for (const value of values) {
    const key = getTable(value);
    const group = out.get(key) ?? [];
    group.push(value.value);
    out.set(key, group);
  }
  return out;
}

function tableObjectKey(schemaName: string, tableName: string): string {
  return JSON.stringify([schemaName, tableName]);
}

function filterSchema(schema: Schema, options: GetSchemaOptions): Schema {
  const filter = buildSchemaFilter(options);
  return {
    namedSchemas: schema.namedSchemas.filter((item) => filter(item.name)),
    extensions: schema.extensions.filter((item) =>
      filter(item.name.schemaName),
    ),
    enums: schema.enums.filter((item) => filter(item.name.schemaName)),
    tables: schema.tables.filter((item) => filter(item.name.schemaName)),
    indexes: schema.indexes.filter((item) =>
      filter(item.owningRelName.schemaName),
    ),
    foreignKeyConstraints: schema.foreignKeyConstraints.filter((item) =>
      filter(item.owningTable.schemaName),
    ),
    sequences: schema.sequences.filter((item) => filter(item.name.schemaName)),
    functions: schema.functions.filter((item) => filter(item.name.schemaName)),
    procedures: schema.procedures.filter((item) =>
      filter(item.name.schemaName),
    ),
    triggers: schema.triggers.filter((item) =>
      filter(item.owningTable.schemaName),
    ),
    views: schema.views.filter((item) => filter(item.name.schemaName)),
    materializedViews: schema.materializedViews.filter((item) =>
      filter(item.name.schemaName),
    ),
  };
}

function buildSchemaFilter(
  options: GetSchemaOptions,
): (schemaName: string) => boolean {
  const include = new Set(options.includeSchemas ?? []);
  const exclude = new Set(options.excludeSchemas ?? []);
  for (const schemaName of include) {
    if (exclude.has(schemaName)) {
      throw new PgSchemaDiffError(
        `schemas [${schemaName}] are both included and excluded`,
      );
    }
  }
  return (schemaName) =>
    (include.size === 0 || include.has(schemaName)) && !exclude.has(schemaName);
}

function buildColumn(table: TableRow, row: ColumnRow): Column {
  const collation =
    row.collation_name.length === 0
      ? null
      : schemaQualifiedName(row.collation_schema_name, row.collation_name);
  const identity = buildIdentity(table, row);
  return {
    kind: "column",
    name: row.column_name,
    type: row.column_type,
    collation,
    default: row.default_value,
    isGenerated: row.is_generated,
    generationExpression: row.generation_expression,
    isNullable: !row.is_not_null,
    hasMissingValOptimization: row.has_missing_val_optimization,
    size: row.column_size,
    identity,
  };
}

function buildIdentity(table: TableRow, row: ColumnRow): ColumnIdentity | null {
  const identityType = row.identity_type;
  if (identityType === "" || table.parent_table_name.length > 0) {
    return null;
  }

  return {
    type: identityType,
    startValue: parseNullableBigInt(row.start_value),
    increment: parseNullableBigInt(row.increment_value),
    maxValue: parseNullableBigInt(row.max_value),
    minValue: parseNullableBigInt(row.min_value),
    cacheSize: parseNullableBigInt(row.cache_size),
    cycle: row.is_cycle ?? false,
  };
}

function parseNullableBigInt(value: string | null): bigint {
  return BigInt(value ?? "0");
}

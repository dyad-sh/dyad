import type { QueryResult } from "pg";
import type { DatabaseClient } from "./connect.js";
import { getSchema, type GetSchemaOptions } from "./introspect.js";
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
import type { Schema } from "../schema/model.js";

type SnapshotRow = Readonly<Record<string, unknown>>;

type SchemaSnapshot = {
  readonly serverVersion: readonly SnapshotRow[];
  readonly schemas: readonly SnapshotRow[];
  readonly extensions: readonly SnapshotRow[];
  readonly enums: readonly SnapshotRow[];
  readonly tables: readonly SnapshotRow[];
  readonly columns: readonly SnapshotRow[];
  readonly checkConstraints: readonly SnapshotRow[];
  readonly policies: readonly SnapshotRow[];
  readonly tablePrivileges: readonly SnapshotRow[];
  readonly indexes: readonly SnapshotRow[];
  readonly foreignKeyConstraints: readonly SnapshotRow[];
  readonly sequences: readonly SnapshotRow[];
  readonly functions: readonly SnapshotRow[];
  readonly procedures: readonly SnapshotRow[];
  readonly functionDependencies: readonly SnapshotRow[];
  readonly triggers: readonly SnapshotRow[];
  readonly views: readonly SnapshotRow[];
  readonly materializedViews: readonly SnapshotRow[];
};

const SNAPSHOT_KEYS = [
  "serverVersion",
  "schemas",
  "extensions",
  "enums",
  "tables",
  "columns",
  "checkConstraints",
  "policies",
  "tablePrivileges",
  "indexes",
  "foreignKeyConstraints",
  "sequences",
  "functions",
  "procedures",
  "functionDependencies",
  "triggers",
  "views",
  "materializedViews",
] as const satisfies readonly (keyof SchemaSnapshot)[];

function withoutTrailingSemicolon(query: string): string {
  return query.trim().replace(/;$/u, "");
}

function queryRows(query: string): string {
  return `COALESCE((SELECT jsonb_agg(to_jsonb(snapshot_row)) FROM (${withoutTrailingSemicolon(query)}) AS snapshot_row), '[]'::jsonb)`;
}

export type BuildSchemaSnapshotOptions = {
  readonly includeSchemas?: readonly string[];
  readonly tableName?: string;
};

function sqlLiteral(value: string): string {
  if (value.includes("\0")) {
    throw new Error("Database schema filter values cannot contain null bytes");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function schemaPredicate(
  column: string,
  includeSchemas: readonly string[] | undefined,
): string | null {
  if (includeSchemas === undefined) {
    return null;
  }
  if (includeSchemas.length === 0) {
    return "FALSE";
  }
  return `snapshot_scope.${column} IN (${includeSchemas.map(sqlLiteral).join(", ")})`;
}

function scopedQuery(
  query: string,
  predicates: readonly (string | null)[],
): string {
  const activePredicates = predicates.filter(
    (predicate): predicate is string => predicate !== null,
  );
  if (activePredicates.length === 0) {
    return query;
  }
  return `SELECT snapshot_scope.*
FROM (${withoutTrailingSemicolon(query)}) AS snapshot_scope
WHERE ${activePredicates.join(" AND ")}`;
}

function replaceRequiredOnce(
  query: string,
  search: string,
  replacement: string,
): string {
  const firstIndex = query.indexOf(search);
  if (
    firstIndex === -1 ||
    query.indexOf(search, firstIndex + search.length) !== -1
  ) {
    throw new Error(
      `Expected database introspection query fragment exactly once: ${search}`,
    );
  }
  return query.replace(search, replacement);
}

/**
 * Build one SQL statement that captures every result set needed by getSchema.
 * This is intended for HTTP database APIs, where each DatabaseClient query
 * would otherwise become a separate network request.
 */
export function buildSchemaSnapshotSql(
  options: BuildSchemaSnapshotOptions = {},
): string {
  const tableName = options.tableName || undefined;
  const tableNamePredicate = (column: string): string | null =>
    tableName === undefined
      ? null
      : `snapshot_scope.${column} = ${sqlLiteral(tableName)}`;
  const tablesSql = scopedQuery(getTablesSql, [
    schemaPredicate("table_schema_name", options.includeSchemas),
    tableNamePredicate("table_name"),
  ]);
  const checkConstraintsSql = scopedQuery(getCheckConstraintsSql, [
    schemaPredicate("table_schema_name", options.includeSchemas),
    tableNamePredicate("table_name"),
  ]);
  const allFunctionsSql = replaceRequiredOnce(getProcsSql, "$1", "'f'");
  const targetTableOidsSql = `SELECT snapshot_table.oid::OID FROM (${withoutTrailingSemicolon(tablesSql)}) AS snapshot_table`;
  const requiredFunctionOidsSql = `WITH RECURSIVE function_roots(oid) AS (
    SELECT trigger_row.tgfoid
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid IN (${targetTableOidsSql})
      AND NOT trigger_row.tgisinternal
    UNION
    SELECT dependency.refobjid
    FROM pg_catalog.pg_depend AS dependency
    INNER JOIN pg_catalog.pg_constraint AS constraint_row
      ON dependency.classid = 'pg_constraint'::REGCLASS
      AND dependency.objid = constraint_row.oid
    WHERE constraint_row.conrelid IN (${targetTableOidsSql})
      AND constraint_row.contype = 'c'
      AND dependency.refclassid = 'pg_proc'::REGCLASS
      AND dependency.deptype = 'n'
    UNION
    SELECT dependency.refobjid
    FROM pg_catalog.pg_depend AS dependency
    INNER JOIN pg_catalog.pg_attrdef AS attrdef_row
      ON dependency.classid = 'pg_attrdef'::REGCLASS
      AND dependency.objid = attrdef_row.oid
    WHERE attrdef_row.adrelid IN (${targetTableOidsSql})
      AND dependency.refclassid = 'pg_proc'::REGCLASS
      AND dependency.deptype = 'n'
    UNION
    SELECT dependency.refobjid
    FROM pg_catalog.pg_depend AS dependency
    INNER JOIN pg_catalog.pg_policy AS policy_row
      ON dependency.classid = 'pg_policy'::REGCLASS
      AND dependency.objid = policy_row.oid
    WHERE policy_row.polrelid IN (${targetTableOidsSql})
      AND dependency.refclassid = 'pg_proc'::REGCLASS
      AND dependency.deptype = 'n'
), required_functions(oid) AS (
    SELECT function_roots.oid FROM function_roots
    UNION
    SELECT dependency.refobjid
    FROM pg_catalog.pg_depend AS dependency
    INNER JOIN required_functions
      ON dependency.classid = 'pg_proc'::REGCLASS
      AND dependency.objid = required_functions.oid
    WHERE dependency.refclassid = 'pg_proc'::REGCLASS
      AND dependency.deptype = 'n'
)
SELECT required_functions.oid FROM required_functions`;
  const requiredFunctionPredicate = `snapshot_scope.oid::OID IN (${requiredFunctionOidsSql})`;
  const functionSchemaPredicate = schemaPredicate(
    "func_schema_name",
    options.includeSchemas,
  );
  const functionsSql =
    tableName === undefined
      ? scopedQuery(allFunctionsSql, [
          functionSchemaPredicate === null
            ? null
            : `(${functionSchemaPredicate} OR ${requiredFunctionPredicate})`,
        ])
      : scopedQuery(allFunctionsSql, [requiredFunctionPredicate]);
  const schemasSql =
    options.includeSchemas === undefined
      ? getSchemasSql
      : `SELECT snapshot_schema.*
FROM (${withoutTrailingSemicolon(scopedQuery(getSchemasSql, [schemaPredicate("schema_name", options.includeSchemas)]))}) AS snapshot_schema
UNION
SELECT DISTINCT snapshot_function.func_schema_name AS schema_name
FROM (${withoutTrailingSemicolon(functionsSql)}) AS snapshot_function`;
  const proceduresSql = scopedQuery(
    replaceRequiredOnce(getProcsSql, "$1", "'p'"),
    tableName === undefined
      ? [schemaPredicate("func_schema_name", options.includeSchemas)]
      : ["FALSE"],
  );
  const allColumnsSql = replaceRequiredOnce(
    getColumnsForTableSql,
    "a.attrelid = $1::OID",
    `a.attrelid IN (${targetTableOidsSql})`,
  );
  const allFunctionDependenciesSql = replaceRequiredOnce(
    replaceRequiredOnce(
      getDependsOnFunctionsSql,
      "depend.classid = $1::REGCLASS",
      `(
        (
            depend.classid = 'pg_constraint'::REGCLASS
            AND depend.objid IN (
                SELECT snapshot_constraint.oid::OID
                FROM (${withoutTrailingSemicolon(checkConstraintsSql)}) AS snapshot_constraint
            )
        )
        OR (
            depend.classid = 'pg_proc'::REGCLASS
            AND depend.objid IN (
                SELECT snapshot_function.oid::OID
                FROM (${withoutTrailingSemicolon(functionsSql)}) AS snapshot_function
            )
        )
    )`,
    ),
    "depend.objid = $2::OID",
    "TRUE",
  );
  const fields: readonly [keyof SchemaSnapshot, string][] = [
    [
      "serverVersion",
      queryRows(
        "SELECT current_setting('server_version_num') AS server_version_num",
      ),
    ],
    ["schemas", queryRows(schemasSql)],
    [
      "extensions",
      queryRows(
        scopedQuery(getExtensionsSql, [
          schemaPredicate("schema_name", options.includeSchemas),
        ]),
      ),
    ],
    [
      "enums",
      queryRows(
        scopedQuery(getEnumsSql, [
          schemaPredicate("enum_schema_name", options.includeSchemas),
        ]),
      ),
    ],
    ["tables", queryRows(tablesSql)],
    ["columns", queryRows(allColumnsSql)],
    ["checkConstraints", queryRows(checkConstraintsSql)],
    [
      "policies",
      queryRows(
        scopedQuery(getPoliciesSql, [
          schemaPredicate("owning_table_schema_name", options.includeSchemas),
          tableNamePredicate("owning_table_name"),
        ]),
      ),
    ],
    [
      "tablePrivileges",
      queryRows(
        scopedQuery(getTablePrivilegesSql, [
          schemaPredicate("table_schema_name", options.includeSchemas),
          tableNamePredicate("table_name"),
        ]),
      ),
    ],
    [
      "indexes",
      queryRows(
        scopedQuery(getIndexesSql, [
          schemaPredicate("table_schema_name", options.includeSchemas),
          tableNamePredicate("table_name"),
        ]),
      ),
    ],
    [
      "foreignKeyConstraints",
      queryRows(
        scopedQuery(getForeignKeyConstraintsSql, [
          schemaPredicate("owning_table_schema_name", options.includeSchemas),
          tableNamePredicate("owning_table_name"),
        ]),
      ),
    ],
    [
      "sequences",
      queryRows(
        scopedQuery(getSequencesSql, [
          schemaPredicate("sequence_schema_name", options.includeSchemas),
        ]),
      ),
    ],
    ["functions", queryRows(functionsSql)],
    ["procedures", queryRows(proceduresSql)],
    ["functionDependencies", queryRows(allFunctionDependenciesSql)],
    [
      "triggers",
      queryRows(
        scopedQuery(getTriggersSql, [
          schemaPredicate("owning_table_schema_name", options.includeSchemas),
          tableNamePredicate("owning_table_name"),
        ]),
      ),
    ],
    [
      "views",
      queryRows(
        scopedQuery(getViewsSql, [
          schemaPredicate("schema_name", options.includeSchemas),
          tableName === undefined ? null : "FALSE",
        ]),
      ),
    ],
    [
      "materializedViews",
      queryRows(
        scopedQuery(getMaterializedViewsSql, [
          schemaPredicate("schema_name", options.includeSchemas),
          tableName === undefined ? null : "FALSE",
        ]),
      ),
    ],
  ];
  const argumentsSql = fields
    .flatMap(([key, expression]) => [`'${key}'`, expression])
    .join(",\n  ");
  return `SELECT jsonb_build_object(\n  ${argumentsSql}\n) AS schema_snapshot;`;
}

function parseSchemaSnapshot(value: unknown): SchemaSnapshot {
  let parsed = value;
  if (typeof parsed === "string") {
    parsed = JSON.parse(parsed) as unknown;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid database schema snapshot");
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  for (const key of SNAPSHOT_KEYS) {
    if (!Array.isArray(record[key])) {
      throw new Error(`Invalid database schema snapshot field: ${key}`);
    }
  }
  return record as SchemaSnapshot;
}

function normalizedQuery(query: string): string {
  return withoutTrailingSemicolon(query);
}

function rowsResult(rows: readonly SnapshotRow[]): QueryResult<SnapshotRow> {
  return { rows } as QueryResult<SnapshotRow>;
}

function buildSnapshotClient(snapshot: SchemaSnapshot): DatabaseClient {
  const fixedQueries = new Map<string, readonly SnapshotRow[]>([
    [normalizedQuery("SHOW server_version_num"), snapshot.serverVersion],
    [normalizedQuery(getSchemasSql), snapshot.schemas],
    [normalizedQuery(getExtensionsSql), snapshot.extensions],
    [normalizedQuery(getEnumsSql), snapshot.enums],
    [normalizedQuery(getTablesSql), snapshot.tables],
    [normalizedQuery(getCheckConstraintsSql), snapshot.checkConstraints],
    [normalizedQuery(getPoliciesSql), snapshot.policies],
    [normalizedQuery(getTablePrivilegesSql), snapshot.tablePrivileges],
    [normalizedQuery(getIndexesSql), snapshot.indexes],
    [
      normalizedQuery(getForeignKeyConstraintsSql),
      snapshot.foreignKeyConstraints,
    ],
    [normalizedQuery(getSequencesSql), snapshot.sequences],
    [normalizedQuery(getTriggersSql), snapshot.triggers],
    [normalizedQuery(getViewsSql), snapshot.views],
    [normalizedQuery(getMaterializedViewsSql), snapshot.materializedViews],
  ]);

  return {
    query: (async (
      queryTextOrConfig: string | { text: string; values?: readonly unknown[] },
      values?: readonly unknown[],
    ) => {
      const queryText =
        typeof queryTextOrConfig === "string"
          ? queryTextOrConfig
          : queryTextOrConfig.text;
      const queryValues =
        values ??
        (typeof queryTextOrConfig === "string"
          ? undefined
          : queryTextOrConfig.values);
      const normalized = normalizedQuery(queryText);
      const fixedRows = fixedQueries.get(normalized);
      if (fixedRows !== undefined) {
        return rowsResult(fixedRows);
      }
      if (normalized === normalizedQuery(getColumnsForTableSql)) {
        const tableOid = String(queryValues?.[0]);
        return rowsResult(
          snapshot.columns.filter((row) => row["table_oid"] === tableOid),
        );
      }
      if (normalized === normalizedQuery(getProcsSql)) {
        return rowsResult(
          queryValues?.[0] === "f" ? snapshot.functions : snapshot.procedures,
        );
      }
      if (normalized === normalizedQuery(getDependsOnFunctionsSql)) {
        const dependentClass = String(queryValues?.[0]);
        const dependentOid = String(queryValues?.[1]);
        return rowsResult(
          snapshot.functionDependencies.filter(
            (row) =>
              row["dependent_class"] === dependentClass &&
              row["dependent_oid"] === dependentOid,
          ),
        );
      }
      throw new Error(
        "Unsupported query requested from database schema snapshot",
      );
    }) as DatabaseClient["query"],
  };
}

export async function getSchemaFromSnapshot(
  value: unknown,
  options: GetSchemaOptions = {},
): Promise<Schema> {
  return getSchema(buildSnapshotClient(parseSchemaSnapshot(value)), options);
}

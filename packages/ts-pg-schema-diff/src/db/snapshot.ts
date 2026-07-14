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

/**
 * Build one SQL statement that captures every result set needed by getSchema.
 * This is intended for HTTP database APIs, where each DatabaseClient query
 * would otherwise become a separate network request.
 */
export function buildSchemaSnapshotSql(): string {
  const functionsSql = getProcsSql.replace("$1", "'f'");
  const proceduresSql = getProcsSql.replace("$1", "'p'");
  const allColumnsSql = getColumnsForTableSql.replace(
    "a.attrelid = $1::OID",
    `a.attrelid IN (
        SELECT snapshot_table.oid::OID
        FROM (${withoutTrailingSemicolon(getTablesSql)}) AS snapshot_table
    )`,
  );
  const allFunctionDependenciesSql = getDependsOnFunctionsSql
    .replace(
      "depend.classid = $1::REGCLASS",
      `(
        (
            depend.classid = 'pg_constraint'::REGCLASS
            AND depend.objid IN (
                SELECT snapshot_constraint.oid::OID
                FROM (${withoutTrailingSemicolon(getCheckConstraintsSql)}) AS snapshot_constraint
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
    )
    .replace("depend.objid = $2::OID", "TRUE");
  const fields: readonly [keyof SchemaSnapshot, string][] = [
    [
      "serverVersion",
      queryRows(
        "SELECT current_setting('server_version_num') AS server_version_num",
      ),
    ],
    ["schemas", queryRows(getSchemasSql)],
    ["extensions", queryRows(getExtensionsSql)],
    ["enums", queryRows(getEnumsSql)],
    ["tables", queryRows(getTablesSql)],
    ["columns", queryRows(allColumnsSql)],
    ["checkConstraints", queryRows(getCheckConstraintsSql)],
    ["policies", queryRows(getPoliciesSql)],
    ["tablePrivileges", queryRows(getTablePrivilegesSql)],
    ["indexes", queryRows(getIndexesSql)],
    ["foreignKeyConstraints", queryRows(getForeignKeyConstraintsSql)],
    ["sequences", queryRows(getSequencesSql)],
    ["functions", queryRows(functionsSql)],
    ["procedures", queryRows(proceduresSql)],
    ["functionDependencies", queryRows(allFunctionDependenciesSql)],
    ["triggers", queryRows(getTriggersSql)],
    ["views", queryRows(getViewsSql)],
    ["materializedViews", queryRows(getMaterializedViewsSql)],
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

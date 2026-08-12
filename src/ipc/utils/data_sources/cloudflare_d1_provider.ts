import {
  assertReadOnly,
  sanitiseDatabaseError,
} from "@/lib/data_sources/read_only";
import type { QueryPlan } from "@/lib/data_sources/query_plan";
import { inlineParameters } from "@/lib/data_sources/sqlite_literal";
import {
  d1Endpoint,
  isD1Endpoint,
  parseD1Endpoint,
} from "@/lib/data_sources/d1_endpoint";
import { executeD1ViaWrangler } from "../cloudflare/environment";

/**
 * Cloudflare D1, over Cloudflare's own REST API.
 *
 * No Worker is deployed. D1 exposes a query endpoint per database, so a Worker
 * would be a second thing to provision, secure and keep in step for no access
 * this does not already have.
 *
 * The token is a Cloudflare API token and never leaves the main process. It is
 * decrypted immediately before a request and is never returned to the renderer
 * or put into a prompt.
 */

const REQUEST_TIMEOUT_MS = 20_000;

export { d1Endpoint, isD1Endpoint, parseD1Endpoint };

type D1Response = {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result?: Array<{
    results?: Array<Record<string, unknown>>;
    success?: boolean;
    meta?: { duration?: number };
  }>;
};

/**
 * One statement against D1.
 *
 * Every caller goes through assertReadOnly first. D1's endpoint will happily
 * run a DROP, so the guard is the only thing standing between a generated
 * query and the user's data.
 */
async function d1Query(input: {
  endpoint: string;
  token: string | null;
  sql: string;
  params?: unknown[];
}): Promise<{ rows: Array<Record<string, unknown>>; durationMs: number }> {
  assertReadOnly(input.sql);

  // No token means the user signed in through the browser, so Wrangler holds
  // the credential and is the only thing that can use it. Values are inlined
  // there because wrangler d1 execute takes no bind parameters; the guard
  // above and the literal encoder are what make that safe.
  if (!input.token) {
    const target = parseD1Endpoint(input.endpoint);
    if (!target) throw new Error("This is not a D1 database endpoint.");

    const startedAt = Date.now();
    const rows = await executeD1ViaWrangler({
      projectRoot: process.cwd(),
      databaseId: target.databaseId,
      sql: inlineParameters(input.sql, input.params ?? []),
    });
    return { rows, durationMs: Date.now() - startedAt };
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(`${input.endpoint}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: input.sql, params: input.params ?? [] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      sanitiseDatabaseError(
        error instanceof Error ? error.message : "Could not reach Cloudflare.",
      ),
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "This Cloudflare API token is not permitted to read that database.",
    );
  }

  const payload = (await response
    .json()
    .catch(() => null)) as D1Response | null;

  if (!response.ok || !payload?.success) {
    const detail =
      payload?.errors?.map((error) => error.message).join("; ") ||
      `Cloudflare returned ${response.status}.`;
    throw new Error(sanitiseDatabaseError(detail));
  }

  return {
    rows: payload.result?.[0]?.results ?? [],
    durationMs: payload.result?.[0]?.meta?.duration ?? Date.now() - startedAt,
  };
}

export type D1Check = { name: string; ok: boolean; detail: string };

/** Whether the endpoint and token actually work, check by check. */
export async function testD1Connection(input: {
  endpoint: string;
  token: string | null;
}): Promise<{
  ok: boolean;
  status: "connected" | "auth_error" | "connection_error";
  checks: D1Check[];
  tablesDiscovered: number | null;
}> {
  const checks: D1Check[] = [];

  if (!isD1Endpoint(input.endpoint)) {
    return {
      ok: false,
      status: "connection_error",
      checks: [
        {
          name: "Database",
          ok: false,
          detail: "This does not look like a D1 database endpoint.",
        },
      ],
      tablesDiscovered: null,
    };
  }
  checks.push({
    name: "Database",
    ok: true,
    detail: "Endpoint is well formed.",
  });

  try {
    const { rows } = await d1Query({
      endpoint: input.endpoint,
      token: input.token,
      // sqlite_master is D1's catalogue. Counting it proves both that the
      // token can read and that the database exists.
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    });
    checks.push({
      name: "Authentication",
      ok: true,
      detail: input.token
        ? "Cloudflare accepted the token."
        : "Signed in through the browser.",
    });
    checks.push({
      name: "Tables",
      ok: true,
      detail: `${rows.length} readable ${rows.length === 1 ? "table" : "tables"}.`,
    });
    return {
      ok: true,
      status: "connected",
      checks,
      tablesDiscovered: rows.length,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not reach Cloudflare.";
    checks.push({ name: "Authentication", ok: false, detail });
    return {
      ok: false,
      status: /permitted|token|signed in/i.test(detail)
        ? "auth_error"
        : "connection_error",
      checks,
      tablesDiscovered: null,
    };
  }
}

export type D1Column = {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
};

export type D1Table = { name: string; columns: D1Column[] };

/**
 * D1's catalogue in the shape the rest of the app already speaks.
 *
 * Converted here rather than teaching persistence and schema search about a
 * second format, so a new provider costs one adapter instead of a change
 * everywhere a schema is read.
 *
 * Relationships are left empty: SQLite records foreign keys per table through
 * PRAGMA foreign_key_list, which is another request per table. Claiming none
 * exist would be wrong, so they are simply absent until that is read too.
 */
export function d1CatalogueToParsedSchema(catalogue: { tables: D1Table[] }): {
  tables: Array<{
    schemaName: string;
    tableName: string;
    tableType: "table" | "view";
    description: string;
    columns: Array<{
      columnName: string;
      dataType: string;
      nullable: boolean;
      defaultValue: string | null;
      description: string;
      primaryKey: boolean;
      isUnique: boolean;
      references: { table: string; column: string } | null;
    }>;
  }>;
  relationships: Array<{
    sourceTable: string;
    sourceColumn: string;
    targetTable: string;
    targetColumn: string;
  }>;
} {
  return {
    tables: catalogue.tables.map((table) => ({
      schemaName: "main",
      tableName: table.name,
      tableType: "table" as const,
      description: "",
      columns: table.columns.map((column) => ({
        columnName: column.name,
        dataType: column.dataType,
        nullable: column.isNullable,
        defaultValue: null,
        description: "",
        primaryKey: column.isPrimaryKey,
        isUnique: column.isPrimaryKey,
        references: null,
      })),
    })),
    relationships: [],
  };
}

/**
 * The database's shape, from SQLite's own catalogue.
 *
 * PRAGMA runs per table rather than in one statement because D1 executes a
 * single statement per request; the alternative is parsing CREATE TABLE text,
 * which is where subtle mistakes about types and constraints come from.
 */
export async function discoverD1Schema(input: {
  endpoint: string;
  token: string | null;
}): Promise<{ tables: D1Table[] }> {
  const { rows } = await d1Query({
    endpoint: input.endpoint,
    token: input.token,
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  });

  const tables: D1Table[] = [];
  for (const row of rows) {
    const name = String(row.name ?? "");
    if (!name) continue;

    // A table name from the catalogue is not user input, but it is still
    // interpolated, so it is restricted to what SQLite allows unquoted.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;

    const info = await d1Query({
      endpoint: input.endpoint,
      token: input.token,
      sql: `PRAGMA table_info(${name})`,
    });

    tables.push({
      name,
      columns: info.rows.map((column) => ({
        name: String(column.name ?? ""),
        dataType: String(column.type ?? "").toLowerCase() || "text",
        isNullable: Number(column.notnull ?? 0) === 0,
        isPrimaryKey: Number(column.pk ?? 0) > 0,
      })),
    });
  }

  return { tables };
}

/**
 * A validated query plan, run against D1.
 *
 * The plan is compiled to SQL here rather than anywhere the model can reach:
 * the model chooses a table, columns and filters, and this turns that choice
 * into a statement that can only be a SELECT.
 */
export async function executeD1Plan(input: {
  endpoint: string;
  token: string | null;
  plan: QueryPlan;
}): Promise<{
  columns: string[];
  rows: string[][];
  rowCount: number;
  executionMs: number;
}> {
  const { sql, params } = d1SqlFromPlan(input.plan);

  const { rows, durationMs } = await d1Query({
    endpoint: input.endpoint,
    token: input.token,
    sql,
    params,
  });

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    columns,
    rows: rows.map((row) =>
      columns.map((column) => {
        const value = row[column];
        if (value === null || value === undefined) return "";
        return typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
      }),
    ),
    rowCount: rows.length,
    executionMs: durationMs,
  };
}

/** Identifiers must be plain names; anything else is refused, not quoted. */
function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsupported identifier: ${value}`);
  }
  return value;
}

/**
 * SQL and bind parameters for a validated plan.
 *
 * Identifiers come from the discovered schema and are checked against a strict
 * pattern before they are interpolated. Values are never interpolated at all:
 * they become bind parameters, so a value cannot become syntax.
 *
 * PostgREST's compiler is deliberately not reused here. It builds a URL query
 * string, which is a different language from SQL, and borrowing it is how a
 * filter ends up meaning something other than it says.
 */
export function d1SqlFromPlan(plan: QueryPlan): {
  sql: string;
  params: unknown[];
} {
  const params: unknown[] = [];

  const selected = (plan.select ?? []).filter((column) => column !== "*");
  const columns =
    selected.length > 0 ? selected.map(identifier).join(", ") : "*";

  const conditions = (plan.filters ?? []).map((filter) => {
    const column = identifier(filter.column);
    switch (filter.operator) {
      case "=":
      case "!=":
      case ">":
      case ">=":
      case "<":
      case "<=":
        params.push(filter.value ?? null);
        return `${column} ${filter.operator} ?`;
      case "like":
        params.push(filter.value ?? null);
        return `${column} LIKE ?`;
      case "ilike":
        // SQLite's LIKE is already case-insensitive for ASCII, which is the
        // closest honest equivalent rather than pretending ILIKE exists.
        params.push(filter.value ?? null);
        return `${column} LIKE ?`;
      case "in": {
        const values = Array.isArray(filter.value)
          ? filter.value
          : [filter.value ?? null];
        if (values.length === 0) return "0 = 1";
        params.push(...values);
        return `${column} IN (${values.map(() => "?").join(", ")})`;
      }
      case "is_null":
        return `${column} IS NULL`;
      case "is_not_null":
        return `${column} IS NOT NULL`;
      default:
        throw new Error(`Unsupported operator: ${filter.operator}`);
    }
  });

  const order = plan.orderBy
    ? ` ORDER BY ${identifier(plan.orderBy.column)} ${
        plan.orderBy.direction === "desc" ? "DESC" : "ASC"
      }`
    : "";

  // Clamped rather than trusted: the plan validator already bounds this, and
  // this is the last place before the database.
  const limit = Math.min(Math.max(Number(plan.limit) || 100, 1), 1000);
  const offset =
    Number(plan.offset) > 0 ? ` OFFSET ${Number(plan.offset)}` : "";

  const sql = [
    `SELECT ${columns} FROM ${identifier(plan.table)}`,
    conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "",
    order,
    ` LIMIT ${limit}`,
    offset,
  ].join("");

  return { sql, params };
}

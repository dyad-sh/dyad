import { Client } from "pg";
import log from "electron-log";

import { decrypt, encrypt } from "../../../main/settings";
import type { Secret } from "@/lib/schemas";
import {
  assertReadOnly,
  sanitiseDatabaseError,
} from "@/lib/data_sources/read_only";
import {
  COLUMNS_SQL,
  ENUMS_SQL,
  FOREIGN_KEYS_SQL,
  KEYS_SQL,
  PING_SQL,
  SERVER_INFO_SQL,
  TABLES_SQL,
} from "@/lib/data_sources/introspection_sql";

/**
 * The Supabase data-source provider.
 *
 * Everything that can see a plaintext credential lives here, in the main
 * process. Nothing in this file is imported by the renderer, and nothing it
 * returns carries a secret: callers get catalogue rows and health results.
 *
 * Schema discovery goes over a direct Postgres connection rather than through
 * PostgREST, because information_schema and pg_catalog are not reachable from
 * the REST API. That choice is what lets someone connect an arbitrary Supabase
 * project without first installing a helper function into it.
 */

const logger = log.scope("data_sources");

/** Long enough for a cold Supabase pooler, short enough to fail visibly. */
const CONNECT_TIMEOUT_MS = 15_000;
const STATEMENT_TIMEOUT_MS = 20_000;

export type ProviderCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

/**
 * The result of Test Connection.
 *
 * Deliberately a list of checks rather than a boolean: "failed" tells a user
 * nothing about whether they typed the URL wrong, pasted the wrong key, or
 * have a firewall in the way.
 */
export type HealthResult = {
  ok: boolean;
  checks: ProviderCheck[];
  tablesDiscovered: number | null;
};

export type DiscoveredColumn = {
  schemaName: string;
  tableName: string;
  columnName: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  description: string;
  primaryKey: boolean;
  isUnique: boolean;
};

export type DiscoveredTable = {
  schemaName: string;
  tableName: string;
  tableType: string;
  description: string;
  estimatedRows: number | null;
};

export type DiscoveredRelationship = {
  constraintName: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
};

export type DiscoveredCatalogue = {
  tables: DiscoveredTable[];
  columns: DiscoveredColumn[];
  relationships: DiscoveredRelationship[];
  enums: { schemaName: string; enumName: string; values: string[] }[];
};

/** Stores a secret in the same encrypted form the rest of the app uses. */
export function encryptCredential(plaintext: string): string {
  return JSON.stringify(encrypt(plaintext));
}

/**
 * Reverses `encryptCredential`, in the main process only.
 *
 * Returns null rather than throwing on a value that will not decrypt, because
 * a credential written on another machine is a connection error to report, not
 * a crash.
 */
export function decryptCredential(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Secret;
    return decrypt(parsed);
  } catch (error) {
    logger.warn("Stored credential could not be decrypted", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

/**
 * Whether a connection string is plausibly a Postgres URI.
 *
 * Cheap validation before we spend fifteen seconds discovering that someone
 * pasted their API key into the wrong field, which is the single most likely
 * mistake this form invites.
 */
export function looksLikeConnectionString(value: string): boolean {
  return /^postgres(ql)?:\/\/[^\s]+$/i.test(value.trim());
}

/** Whether a URL is plausibly a Supabase project URL. */
export function looksLikeProjectUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Opens a connection with the timeouts and read-only session set.
 *
 * `default_transaction_read_only` is a belt to the query guard's braces: even
 * if a write somehow reached the driver, the session would refuse it. It costs
 * nothing and closes the gap between "we validate" and "the database enforces".
 */
async function connect(connectionString: string): Promise<Client> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS,
    application_name: "MetaHumanOS",
    // Supabase terminates TLS with its own certificate chain; verifying it
    // properly needs their CA bundle, which we do not ship. This matches how
    // the Supabase CLI and most clients connect.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("set session characteristics as transaction read only");
  return client;
}

/** Runs a statement after the read-only guard has cleared it. */
async function runGuarded(
  client: Client,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const check = assertReadOnly(sql);
  if (!check.ok) {
    throw new Error(check.rejection.message);
  }
  const result = await client.query(check.sql);
  return result.rows as Record<string, unknown>[];
}

/**
 * Tests a data source and reports what worked.
 *
 * The Supabase REST check and the Postgres check are independent: a project
 * can be reachable while the database credential is wrong, and knowing which
 * half failed is the whole point of the exercise.
 */
export async function testConnection(input: {
  projectUrl: string;
  apiKey: string | null;
  connectionString: string | null;
}): Promise<HealthResult> {
  const checks: ProviderCheck[] = [];
  let tablesDiscovered: number | null = null;

  // 1. Project URL shape.
  if (!looksLikeProjectUrl(input.projectUrl)) {
    checks.push({
      name: "Project URL",
      ok: false,
      detail: "This does not look like an https project URL.",
    });
  } else {
    checks.push({ name: "Project URL", ok: true, detail: input.projectUrl });
  }

  // 2. Supabase REST reachability. Optional: the API key is useful but not
  // required for the schema work, so a missing one is reported, not failed.
  if (!input.apiKey) {
    checks.push({
      name: "Supabase API",
      ok: true,
      detail: "No API key provided; skipped.",
    });
  } else if (looksLikeProjectUrl(input.projectUrl)) {
    try {
      const response = await fetch(
        new URL("/rest/v1/", input.projectUrl).toString(),
        {
          headers: {
            apikey: input.apiKey,
            Authorization: `Bearer ${input.apiKey}`,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      checks.push({
        name: "Supabase API",
        ok: response.ok || response.status === 404,
        detail: response.ok
          ? "Credential accepted."
          : `Project responded ${response.status}.`,
      });
    } catch (error) {
      checks.push({
        name: "Supabase API",
        ok: false,
        detail: sanitiseDatabaseError(error),
      });
    }
  }

  // 3. Postgres, which is what discovery actually needs.
  if (!input.connectionString) {
    checks.push({
      name: "PostgreSQL",
      ok: false,
      detail: "A connection string is required to read the schema.",
    });
  } else if (!looksLikeConnectionString(input.connectionString)) {
    checks.push({
      name: "PostgreSQL",
      ok: false,
      detail: "This does not look like a postgres:// connection string.",
    });
  } else {
    let client: Client | null = null;
    try {
      client = await connect(input.connectionString);
      await runGuarded(client, PING_SQL);
      checks.push({ name: "PostgreSQL", ok: true, detail: "Connected." });

      const info = await runGuarded(client, SERVER_INFO_SQL);
      const row = info[0] ?? {};
      checks.push({
        name: "Database",
        ok: true,
        detail: `${String(row.database ?? "?")} as ${String(row.role ?? "?")}`,
      });

      const tables = await runGuarded(client, TABLES_SQL);
      tablesDiscovered = tables.length;
      checks.push({
        name: "Schema access",
        ok: true,
        detail: `${tables.length} tables and views visible.`,
      });
    } catch (error) {
      checks.push({
        name: "PostgreSQL",
        ok: false,
        // Sanitised: a libpq failure can carry the whole connection string.
        detail: sanitiseDatabaseError(error),
      });
    } finally {
      await client?.end().catch(() => {});
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    tablesDiscovered,
  };
}

/**
 * Reads the catalogue.
 *
 * Metadata only: no user rows are read, so this is safe to run against a
 * production database without asking anyone to think about it first.
 */
export async function discoverSchema(
  connectionString: string,
): Promise<DiscoveredCatalogue> {
  let client: Client | null = null;
  try {
    client = await connect(connectionString);

    const [tableRows, columnRows, keyRows, fkRows, enumRows] =
      await Promise.all([
        runGuarded(client, TABLES_SQL),
        runGuarded(client, COLUMNS_SQL),
        runGuarded(client, KEYS_SQL),
        runGuarded(client, FOREIGN_KEYS_SQL),
        runGuarded(client, ENUMS_SQL),
      ]);

    // Key lookups, so a column can be marked without another round trip.
    const primaryKeys = new Set<string>();
    const uniques = new Set<string>();
    for (const row of keyRows) {
      const key = `${row.schema_name}.${row.table_name}.${row.column_name}`;
      if (row.constraint_type === "p") primaryKeys.add(key);
      else uniques.add(key);
    }

    const enums = new Map<
      string,
      { schemaName: string; enumName: string; values: string[] }
    >();
    for (const row of enumRows) {
      const key = `${row.schema_name}.${row.enum_name}`;
      const existing = enums.get(key);
      if (existing) existing.values.push(String(row.enum_value));
      else
        enums.set(key, {
          schemaName: String(row.schema_name),
          enumName: String(row.enum_name),
          values: [String(row.enum_value)],
        });
    }

    return {
      tables: tableRows.map((row) => ({
        schemaName: String(row.schema_name),
        tableName: String(row.table_name),
        tableType: String(row.table_type),
        description: String(row.description ?? ""),
        estimatedRows:
          row.estimated_rows === null || row.estimated_rows === undefined
            ? null
            : Number(row.estimated_rows),
      })),
      columns: columnRows.map((row) => {
        const key = `${row.schema_name}.${row.table_name}.${row.column_name}`;
        return {
          schemaName: String(row.schema_name),
          tableName: String(row.table_name),
          columnName: String(row.column_name),
          dataType: String(row.data_type),
          nullable: Boolean(row.nullable),
          defaultValue:
            row.default_value === null || row.default_value === undefined
              ? null
              : String(row.default_value),
          description: String(row.description ?? ""),
          primaryKey: primaryKeys.has(key),
          isUnique: uniques.has(key),
        };
      }),
      relationships: fkRows.map((row) => ({
        constraintName: String(row.constraint_name),
        sourceSchema: String(row.source_schema),
        sourceTable: String(row.source_table),
        sourceColumn: String(row.source_column),
        targetSchema: String(row.target_schema),
        targetTable: String(row.target_table),
        targetColumn: String(row.target_column),
      })),
      enums: [...enums.values()],
    };
  } finally {
    await client?.end().catch(() => {});
  }
}

/**
 * A plain-language guess at what a table holds.
 *
 * Built from names, types and keys rather than from a model call, so it is
 * free, deterministic and available the moment discovery finishes. It is
 * stored in `semantic_description`, kept apart from the database's own
 * comment, so an answer can always say which of the two it relied on.
 */
export function describeTableSemantically(
  table: DiscoveredTable,
  columns: DiscoveredColumn[],
  relationships: DiscoveredRelationship[],
): string {
  if (table.description) {
    // The database said what it is; our guess adds nothing.
    return "";
  }

  const names = columns.map((column) => column.columnName);
  const parts: string[] = [];

  const identity = names.filter((name) =>
    /(^|_)(email|name|title|username|handle|label)($|_)/i.test(name),
  );
  const timestamps = names.filter((name) =>
    /(^|_)(created|updated|deleted|inserted|modified)_?(at|on|time)?$/i.test(
      name,
    ),
  );
  const money = names.filter((name) =>
    /(^|_)(amount|total|price|cost|value|balance|fee)($|_)/i.test(name),
  );
  const state = names.filter((name) =>
    /(^|_)(status|state|stage|type|kind|category)($|_)/i.test(name),
  );
  const json = columns
    .filter((column) => /json/i.test(column.dataType))
    .map((column) => column.columnName);

  const outbound = relationships.filter(
    (link) =>
      link.sourceSchema === table.schemaName &&
      link.sourceTable === table.tableName,
  );

  parts.push(
    `Appears to hold ${table.tableType === "view" ? "a view of " : ""}records with ${columns.length} columns`,
  );
  if (identity.length)
    parts.push(`identifying fields (${identity.join(", ")})`);
  if (state.length) parts.push(`a state field (${state.join(", ")})`);
  if (money.length) parts.push(`numeric values (${money.join(", ")})`);
  if (timestamps.length) parts.push(`timestamps (${timestamps.join(", ")})`);
  if (json.length) parts.push(`JSON payloads (${json.join(", ")})`);
  if (outbound.length) {
    parts.push(
      `references to ${[...new Set(outbound.map((link) => link.targetTable))].join(", ")}`,
    );
  }

  return `${parts.join(", ")}.`;
}

import log from "electron-log";

import { decrypt, encrypt } from "../../../main/settings";
import type { Secret } from "@/lib/schemas";
import {
  classifyHttpStatus,
  parsePostgrestSchema,
  type ParsedSchema,
  type ParsedTable,
} from "@/lib/data_sources/postgrest_schema";
import { sanitiseDatabaseError } from "@/lib/data_sources/read_only";
import {
  buildMutationUrl,
  buildQueryUrl,
  compileQueryPlan,
  parseContentRange,
} from "@/lib/data_sources/postgrest_query";
import type { QueryPlan } from "@/lib/data_sources/query_plan";
import type { ValidatedDataMutationPlan } from "@/lib/data_sources/mutation_plan";

/**
 * The Supabase data-source provider.
 *
 * Everything that can see a plaintext key lives here, in the main process.
 * Nothing in this file is imported by the renderer, and nothing it returns
 * carries a secret.
 *
 * A project is reached entirely through its REST endpoint using the key the
 * user supplied. That keeps the connect form to a URL and a key, and it means
 * MyMeta sees exactly what that key is allowed to see: row-level security and
 * grants apply because nothing here goes around them.
 */

const logger = log.scope("data_sources");

/** Long enough for a cold project, short enough to fail visibly. */
const REQUEST_TIMEOUT_MS = 15_000;

export type ProviderCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type ConnectionStatus =
  | "connected"
  | "auth_error"
  | "connection_error"
  | "unknown";

/**
 * The result of a connection test.
 *
 * A list of checks rather than a boolean, and a status rather than a pass or
 * fail: a wrong key and an unreachable project need different responses from
 * the user, so they get different words.
 */
export type HealthResult = {
  ok: boolean;
  status: ConnectionStatus;
  checks: ProviderCheck[];
  tablesDiscovered: number | null;
};

/** Stores a secret in the same encrypted form the rest of the app uses. */
export function encryptCredential(plaintext: string): string {
  return JSON.stringify(encrypt(plaintext));
}

/**
 * Reverses `encryptCredential`, in the main process only.
 *
 * Returns null rather than throwing on a value that will not decrypt, because
 * a key written on another machine is a connection error to report, not a
 * crash.
 */
export function decryptCredential(stored: string | null): string | null {
  if (!stored) return null;
  try {
    return decrypt(JSON.parse(stored) as Secret);
  } catch (error) {
    logger.warn("Stored credential could not be decrypted", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

/** Whether a URL is plausibly a Supabase project URL. */
export function looksLikeProjectUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** The REST root, which is both the health check and the schema document. */
function restRoot(projectUrl: string): string {
  return new URL("/rest/v1/", projectUrl.trim()).toString();
}

async function fetchOpenApi(
  projectUrl: string,
  key: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(restRoot(projectUrl), {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/openapi+json, application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON body is not fatal: the status still tells us what happened.
    body = null;
  }
  return { status: response.status, body };
}

/**
 * Tests a project URL and key, and reports what worked.
 *
 * One network call does both jobs: the REST root answers whether the project
 * exists and whether the key is accepted, and its body is the schema. Testing
 * and discovering are the same request, so a successful test can report the
 * table count without a second round trip.
 */
export async function testConnection(input: {
  projectUrl: string;
  key: string | null;
}): Promise<HealthResult> {
  const checks: ProviderCheck[] = [];

  if (!looksLikeProjectUrl(input.projectUrl)) {
    return {
      ok: false,
      status: "connection_error",
      checks: [
        {
          name: "Project URL",
          ok: false,
          detail: "This does not look like an https project URL.",
        },
      ],
      tablesDiscovered: null,
    };
  }
  checks.push({ name: "Project URL", ok: true, detail: input.projectUrl });

  if (!input.key) {
    return {
      ok: false,
      status: "auth_error",
      checks: [
        ...checks,
        { name: "Connection key", ok: false, detail: "No key supplied." },
      ],
      tablesDiscovered: null,
    };
  }

  try {
    const { status, body } = await fetchOpenApi(input.projectUrl, input.key);
    const failure = classifyHttpStatus(status);

    if (failure === "auth") {
      checks.push({
        name: "Connection key",
        ok: false,
        detail: "The project rejected this key.",
      });
      return {
        ok: false,
        status: "auth_error",
        checks,
        tablesDiscovered: null,
      };
    }
    if (failure) {
      checks.push({
        name: "Project",
        ok: false,
        detail:
          failure === "not_found"
            ? "No REST API found at that URL."
            : `The project responded ${status}.`,
      });
      return {
        ok: false,
        status: "connection_error",
        checks,
        tablesDiscovered: null,
      };
    }

    checks.push({ name: "Connection key", ok: true, detail: "Accepted." });

    const schema = parsePostgrestSchema(body);
    checks.push({
      name: "Accessible data",
      ok: true,
      // Zero is a legitimate outcome for a restricted key, and saying so is
      // more useful than implying something is broken.
      detail:
        schema.tables.length > 0
          ? `${schema.tables.length} tables and views readable with this key.`
          : "Connected, but this key cannot read any tables.",
    });

    return {
      ok: true,
      status: "connected",
      checks,
      tablesDiscovered: schema.tables.length,
    };
  } catch (error) {
    checks.push({
      name: "Project",
      ok: false,
      detail: sanitiseDatabaseError(error),
    });
    return {
      ok: false,
      status: "connection_error",
      checks,
      tablesDiscovered: null,
    };
  }
}

/**
 * Reads everything the key is allowed to see.
 *
 * Metadata only. Nothing here reads a row of user data, so a sync against a
 * production project is safe by construction rather than by policy.
 */
export async function discoverSchema(input: {
  projectUrl: string;
  key: string;
}): Promise<ParsedSchema> {
  const { status, body } = await fetchOpenApi(input.projectUrl, input.key);
  const failure = classifyHttpStatus(status);
  if (failure === "auth") {
    throw new Error("The project rejected this key.");
  }
  if (failure) {
    throw new Error(`The project responded ${status}.`);
  }
  return parsePostgrestSchema(body);
}

/**
 * A plain-language guess at what a table holds.
 *
 * Built from names, types and keys rather than from a model call, so it is
 * free, deterministic, and available the moment discovery finishes. Stored
 * apart from any comment the database supplies, so an answer can always say
 * which of the two it relied on.
 */
export function describeTableSemantically(
  table: ParsedTable,
  relationships: { sourceTable: string; targetTable: string }[],
): string {
  if (table.description) {
    // The project said what it is; a guess adds nothing.
    return "";
  }

  const names = table.columns.map((column) => column.columnName);
  const parts: string[] = [];

  const identity = names.filter((name) =>
    /(^|_)(email|name|title|username|handle|label|phone)($|_)/i.test(name),
  );
  const timestamps = names.filter((name) =>
    /(^|_)(created|updated|deleted|inserted|modified)_?(at|on|time)?$/i.test(
      name,
    ),
  );
  const quantities = names.filter((name) =>
    /(^|_)(amount|total|price|cost|value|balance|count|quantity|score)($|_)/i.test(
      name,
    ),
  );
  const state = names.filter((name) =>
    /(^|_)(status|state|stage|type|kind|category)($|_)/i.test(name),
  );
  const json = table.columns
    .filter((column) => /json/i.test(column.dataType))
    .map((column) => column.columnName);

  const outbound = [
    ...new Set(
      relationships
        .filter((link) => link.sourceTable === table.tableName)
        .map((link) => link.targetTable),
    ),
  ];

  parts.push(
    `Appears to hold ${table.tableType === "view" ? "a derived view of " : ""}records with ${table.columns.length} columns`,
  );
  if (identity.length)
    parts.push(`identifying fields (${identity.join(", ")})`);
  if (state.length) parts.push(`a state field (${state.join(", ")})`);
  if (quantities.length)
    parts.push(`numeric values (${quantities.join(", ")})`);
  if (timestamps.length) parts.push(`timestamps (${timestamps.join(", ")})`);
  if (json.length) parts.push(`JSON payloads (${json.join(", ")})`);
  if (outbound.length) parts.push(`references to ${outbound.join(", ")}`);

  return `${parts.join(", ")}.`;
}

export type QueryOutcome = {
  rows: unknown[];
  /** Total matching rows, or null when the project did not report one. */
  totalRows: number | null;
  executionMs: number;
};

export type MutationOutcome = {
  rows: unknown[];
  affectedRows: number;
  executionMs: number;
};

/** Executes one schema-validated PostgREST insert, update, or delete. */
export async function executeMutation(input: {
  projectUrl: string;
  key: string;
  plan: ValidatedDataMutationPlan;
}): Promise<MutationOutcome> {
  const method =
    input.plan.action === "insert"
      ? "POST"
      : input.plan.action === "update"
        ? "PATCH"
        : "DELETE";
  const url = buildMutationUrl(
    input.projectUrl,
    input.plan.table,
    input.plan.filters,
  );
  const startedAt = Date.now();
  const response = await fetch(url, {
    method,
    headers: {
      apikey: input.key,
      Authorization: `Bearer ${input.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation,count=exact",
    },
    ...(method === "DELETE" ? {} : { body: JSON.stringify(input.plan.values) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("This connection key is not permitted to write that data.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string };
      detail = typeof body?.message === "string" ? body.message : "";
    } catch {
      // The status remains useful when the provider did not return JSON.
    }
    throw new Error(
      sanitiseDatabaseError(
        detail || `The project responded ${response.status}.`,
      ),
    );
  }

  const payload = (await response.json().catch(() => [])) as unknown;
  const rows = Array.isArray(payload) ? payload : [];
  return {
    rows,
    affectedRows:
      parseContentRange(response.headers.get("content-range")) ?? rows.length,
    executionMs: Date.now() - startedAt,
  };
}

/**
 * Runs a validated plan against the project.
 *
 * Read-only by construction: this issues a GET, and there is no code path here
 * that can issue anything else. A permission failure is surfaced as itself
 * rather than retried with different credentials, because working around a
 * project's access rules is exactly what this feature must not do.
 */
export async function executePlan(input: {
  projectUrl: string;
  key: string;
  plan: QueryPlan;
}): Promise<QueryOutcome> {
  const compiled = compileQueryPlan(input.plan);
  const url = buildQueryUrl(input.projectUrl, compiled);
  const startedAt = Date.now();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: input.key,
      Authorization: `Bearer ${input.key}`,
      Accept: "application/json",
      ...compiled.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const executionMs = Date.now() - startedAt;

  if (response.status === 401 || response.status === 403) {
    throw new Error("This connection key is not permitted to read that data.");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string };
      detail = typeof body?.message === "string" ? body.message : "";
    } catch {
      // A non-JSON error body still leaves the status to report.
    }
    throw new Error(
      sanitiseDatabaseError(
        detail || `The project responded ${response.status}.`,
      ),
    );
  }

  const rows = (await response.json()) as unknown[];
  return {
    rows: Array.isArray(rows) ? rows : [],
    totalRows: parseContentRange(response.headers.get("content-range")),
    executionMs,
  };
}

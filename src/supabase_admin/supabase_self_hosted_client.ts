import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  SUPABASE_SELF_HOSTED_REQUEST_ERROR_NAME,
  SUPABASE_SELF_HOSTED_TRANSPORT_ERROR_NAME,
} from "@/shared/supabase_self_hosted_error_names";
import { isLoopbackHostname } from "@/shared/supabase_self_hosted_url";

/**
 * Below postgres-meta's own ~55s read timeout. postgres-meta answers 408 at
 * that point but leaves the query running, so the server-side limit has to
 * fire first.
 */
const STATEMENT_TIMEOUT = "45s";
const REQUEST_TIMEOUT_MS = 60_000;
const CHECK_TIMEOUT_MS = 15_000;

/**
 * Prepended to every query. Some installs (the Coolify template among them)
 * run postgres-meta as the `supabase_admin` superuser; switching to `postgres`
 * gives the same permissions as SQL run through Supabase Cloud.
 */
const QUERY_PREFIX = `set role postgres; set statement_timeout = '${STATEMENT_TIMEOUT}';\n`;

/** A non-2xx from the instance. Carries the status for callers that branch. */
export class SupabaseSelfHostedRequestError extends DyadError {
  readonly status: number;

  constructor(message: string, kind: DyadErrorKind, status: number) {
    super(message, kind);
    this.name = SUPABASE_SELF_HOSTED_REQUEST_ERROR_NAME;
    this.status = status;
  }
}

/** The instance could not be reached at all. */
export class SupabaseSelfHostedTransportError extends DyadError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, DyadErrorKind.External, options);
    this.name = SUPABASE_SELF_HOSTED_TRANSPORT_ERROR_NAME;
  }
}

interface InstanceTarget {
  url: string;
}

/** Legacy anon/service_role keys are JWTs and also go on Authorization. */
export function supabaseSelfHostedAuthHeaders(
  key: string,
): Record<string, string> {
  return key.startsWith("sb_")
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
}

async function request(
  instance: InstanceTarget,
  path: string,
  {
    method = "GET",
    key,
    body,
    signal,
    timeoutMs = REQUEST_TIMEOUT_MS,
  }: {
    method?: string;
    key: string;
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<{ status: number; text: string }> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(`${instance.url}${path}`, {
      method,
      signal: combined,
      // The main-process fetch would otherwise attach cookies from the default
      // session; every call here authenticates with a key instead.
      credentials: "omit",
      redirect: "manual",
      headers: {
        ...supabaseSelfHostedAuthHeaders(key),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) {
      throw new SupabaseSelfHostedTransportError(
        `The self-hosted Supabase instance at ${instance.url} did not answer in time.`,
        { cause: error },
      );
    }
    throw new SupabaseSelfHostedTransportError(
      `Couldn't reach the self-hosted Supabase instance at ${instance.url}: ${describeFetchFailure(error)}`,
      { cause: error },
    );
  }
}

/** Node's "fetch failed" hides the useful part in `cause`. */
export function describeFetchFailure(error: unknown): string {
  // Undici nests the socket error in `cause`, and wraps each address it
  // tried in an AggregateError when a host has several.
  const codes: string[] = [];
  let message: string | undefined;
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 5) return;
    const {
      code,
      message: text,
      cause,
      errors,
    } = value as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof code === "string" && !codes.includes(code)) codes.push(code);
    if (depth > 0 && typeof text === "string" && text) message ??= text;
    visit(cause, depth + 1);
    if (Array.isArray(errors)) {
      for (const inner of errors) visit(inner, depth + 1);
    }
  };
  visit(error, 0);
  if (codes.length > 0) return codes.join(", ");
  if (message) return message;
  return error instanceof Error ? error.message : String(error);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Postgres reports the line of the failing statement counted from the start of
 * the query text. The prefix adds one line, so the user's line 1 arrives as
 * line 2.
 */
function adjustLineNumbers(postgresError: string): string {
  return postgresError.replace(
    /^LINE (\d+):/gm,
    (_match, line: string) => `LINE ${Math.max(1, Number(line) - 1)}:`,
  );
}

/**
 * Builds the error for a failed query in the same shape Supabase Cloud's
 * Management API uses ("Failed to run sql query: <Postgres error>"), so the
 * agent and the error surfaces see the same text for either backend.
 */
function queryError(
  instance: InstanceTarget,
  status: number,
  text: string,
): SupabaseSelfHostedRequestError {
  const body = parseJson(text) as
    | { formattedError?: unknown; message?: unknown; error?: unknown }
    | undefined;
  if (status === 401 || status === 403) {
    return new SupabaseSelfHostedRequestError(
      `The self-hosted Supabase instance at ${instance.url} rejected the service key (${status}). Check the service_role or secret key in Dyad.`,
      DyadErrorKind.Auth,
      status,
    );
  }
  if (status === 404) {
    return new SupabaseSelfHostedRequestError(
      `The self-hosted Supabase instance at ${instance.url} has no /pg/query route. Dyad runs SQL through postgres-meta behind the API gateway, so the gateway must expose /pg/.`,
      DyadErrorKind.Precondition,
      status,
    );
  }
  if (status === 408) {
    return new SupabaseSelfHostedRequestError(
      "Failed to run sql query: the query took too long and was stopped.",
      DyadErrorKind.External,
      status,
    );
  }
  const postgresError =
    typeof body?.formattedError === "string"
      ? body.formattedError
      : typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : text;
  return new SupabaseSelfHostedRequestError(
    `Failed to run sql query: ${adjustLineNumbers(postgresError)}`,
    status === 400 ? DyadErrorKind.Validation : DyadErrorKind.External,
    status,
  );
}

/**
 * Runs SQL through postgres-meta behind the instance's API gateway and returns
 * the rows of the last statement, matching Supabase Cloud's
 * `/v1/projects/{ref}/database/query`.
 */
export async function runSupabaseSelfHostedQuery(
  instance: InstanceTarget & { serviceKey: string },
  query: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const { status, text } = await request(instance, "/pg/query", {
    method: "POST",
    key: instance.serviceKey,
    body: { query: QUERY_PREFIX + query },
    signal,
  });
  if (status < 200 || status >= 300) {
    throw queryError(instance, status, text);
  }
  const rows = parseJson(text);
  if (rows === undefined) {
    throw new SupabaseSelfHostedRequestError(
      `The self-hosted Supabase instance at ${instance.url} returned a response that is not JSON.`,
      DyadErrorKind.External,
      status,
    );
  }
  return rows;
}

/**
 * Normalizes a user-entered URL to an origin plus optional path, without a
 * trailing slash. Returns null for anything that is not http(s).
 */
export function normalizeSupabaseSelfHostedUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/**
 * Whether two URLs reach the same server. Loopback names are one machine, so
 * a link to localhost matches an instance entered as 127.0.0.1.
 */
export function isSameServer(a: URL, b: URL): boolean {
  if (a.origin === b.origin) return true;
  return (
    isLoopbackHostname(a.hostname) &&
    isLoopbackHostname(b.hostname) &&
    a.protocol === b.protocol &&
    a.port === b.port
  );
}

/**
 * Connect-time checks for a new instance. Throws a DyadError describing the
 * first requirement that is not met.
 */
export async function checkSupabaseSelfHostedInstance(input: {
  url: string;
  anonKey: string;
  serviceKey: string;
  signal?: AbortSignal;
}): Promise<void> {
  const instance = { url: input.url };

  const health = await request(instance, "/auth/v1/health", {
    key: input.anonKey,
    signal: input.signal,
    timeoutMs: CHECK_TIMEOUT_MS,
  });
  if (health.status === 401 || health.status === 403) {
    throw new DyadError(
      `The instance rejected the anon key (${health.status}). Check that it is the anon or publishable key for this instance.`,
      DyadErrorKind.Validation,
    );
  }
  if (health.status < 200 || health.status >= 300) {
    throw new DyadError(
      `The instance's auth service did not respond as expected (${health.status}). Check that the URL points at the Supabase API gateway, not Studio.`,
      DyadErrorKind.Validation,
    );
  }

  try {
    await runSupabaseSelfHostedQuery(
      { url: input.url, serviceKey: input.serviceKey },
      "select 1",
      input.signal,
    );
  } catch (error) {
    if (error instanceof SupabaseSelfHostedRequestError) {
      throw new DyadError(
        error.status === 401 || error.status === 403
          ? `The instance rejected the service key (${error.status}). Check that it is the service_role or secret key for this instance.`
          : error.message,
        DyadErrorKind.Validation,
      );
    }
    throw error;
  }

  const anonSql = await request(instance, "/pg/query", {
    method: "POST",
    key: input.anonKey,
    body: { query: "select 1" },
    signal: input.signal,
    timeoutMs: CHECK_TIMEOUT_MS,
  });
  if (anonSql.status >= 200 && anonSql.status < 300) {
    throw new DyadError(
      "This instance lets the anon key run SQL through /pg/query, so anyone with the app's public key could read or change the whole database. Restrict /pg/ to the service key in the API gateway before connecting.",
      DyadErrorKind.Validation,
    );
  }
}

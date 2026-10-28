import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const OPERATIONS = {
  create: "create a temporary Auth user (POST /auth/v1/admin/users)",
  delete: "delete a temporary Auth user (DELETE /auth/v1/admin/users/{userId})",
  verify:
    "verify that no Auth user was created (POST /v1/projects/{ref}/database/query)",
  rls: "verify Row-Level Security (POST /v1/projects/{ref}/database/query)",
  adminKey: "retrieve an admin API key (GET /v1/projects/{ref}/api-keys)",
} as const;

// Fixed explanations, never the provider's message, details, hint, or values.
// https://supabase.com/docs/guides/auth/debugging/error-codes
// https://www.postgresql.org/docs/current/errcodes-appendix.html
const PROVIDER_ERROR_REASONS = {
  email_address_invalid: "Supabase rejected the email address or its domain.",
  email_exists: "An account already uses this email address.",
  user_already_exists: "An account with these details already exists.",
  validation_failed: "Request parameters failed validation.",
  bad_json: "Supabase could not parse the request JSON.",
  weak_password:
    "The password does not meet the project's strength requirements.",
  not_admin: "The API key does not grant Auth admin permissions.",
  bad_jwt: "Supabase could not validate the authorization JWT.",
  no_authorization: "The request is missing authorization.",
  signup_disabled: "Account creation is disabled.",
  email_provider_disabled: "Email/password signups are disabled.",
  user_not_found: "The requested Auth user does not exist.",
  conflict: "A concurrent database operation conflicted with this request.",
  unexpected_failure: "Supabase Auth reported an unspecified server failure.",
  request_timeout: "Supabase timed out processing the request.",
  hook_timeout: "An Auth hook did not complete in time.",
  hook_timeout_after_retry: "An Auth hook did not complete after retries.",
  over_request_rate_limit: "The client request rate limit was exceeded.",
  "23000": "A database integrity constraint rejected the operation.",
  "23001": "Related database records prevent this operation.",
  "23502": "A required database value is missing.",
  "23503": "A database foreign-key constraint rejected the operation.",
  "23505": "A database uniqueness constraint rejected the operation.",
  "23514": "A database check constraint rejected the operation.",
  "23P01": "A database exclusion constraint rejected the operation.",
  P0001:
    "A database function raised an exception. Check database triggers and logs.",
  "42501": "Database permissions do not allow this operation.",
} as const;

/** Parse once for classification and diagnostics; callers must not log the body. */
export function parseSupabaseTestUserErrorResponse(
  text: string,
): Record<string, unknown> | undefined {
  try {
    const body: unknown = JSON.parse(text);
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function recognizedProviderCode(
  body?: Record<string, unknown>,
): keyof typeof PROVIDER_ERROR_REASONS | undefined {
  const code = body?.error_code ?? body?.code;
  return typeof code === "string" && Object.hasOwn(PROVIDER_ERROR_REASONS, code)
    ? (code as keyof typeof PROVIDER_ERROR_REASONS)
    : undefined;
}

const NETWORK_GUIDANCE = {
  ENOTFOUND: "Check DNS and network access to your Supabase project.",
  EAI_AGAIN: "Check DNS and network access to your Supabase project.",
  ECONNREFUSED:
    "Check your Supabase project's availability and firewall or proxy settings.",
  ECONNRESET: "Check network stability and firewall or proxy settings.",
  ECONNABORTED: "Check network stability and firewall or proxy settings.",
  EPIPE: "Check network stability and firewall or proxy settings.",
  ENETUNREACH: "Check network access and firewall or proxy settings.",
  EHOSTUNREACH: "Check network access and firewall or proxy settings.",
  ETIMEDOUT: "Check network access and your Supabase project's availability.",
  UND_ERR_CONNECT_TIMEOUT:
    "Check network access and your Supabase project's availability.",
  UND_ERR_HEADERS_TIMEOUT:
    "Check network access and your Supabase project's availability.",
  UND_ERR_BODY_TIMEOUT:
    "Check network access and your Supabase project's availability.",
  UND_ERR_SOCKET: "Check network stability and firewall or proxy settings.",
  CERT_HAS_EXPIRED:
    "Check certificate trust and any HTTPS-inspecting proxy used by Dyad.",
  DEPTH_ZERO_SELF_SIGNED_CERT:
    "Check certificate trust and any HTTPS-inspecting proxy used by Dyad.",
  SELF_SIGNED_CERT_IN_CHAIN:
    "Check certificate trust and any HTTPS-inspecting proxy used by Dyad.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    "Check certificate trust and any HTTPS-inspecting proxy used by Dyad.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
    "Check certificate trust and any HTTPS-inspecting proxy used by Dyad.",
  ERR_TLS_CERT_ALTNAME_INVALID:
    "Check certificate trust and any HTTPS-inspecting proxy used by Dyad.",
} as const;

/** Project only known codes, never arbitrary messages, URLs, headers or bodies.
 * Unknown transport detail is deliberately omitted rather than relying on a
 * secret denylist. Bound both traversal and output, including aggregate causes.
 */
function transportFailure(error: unknown) {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  const codes = new Set<keyof typeof NETWORK_GUIDANCE>();
  let timedOut = false;
  let invalidResponse = false;
  for (let index = 0; index < pending.length && index < 16; index++) {
    const current = pending[index];
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const fields = current as {
      code?: unknown;
      name?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (
      typeof fields.code === "string" &&
      Object.hasOwn(NETWORK_GUIDANCE, fields.code)
    ) {
      codes.add(fields.code as keyof typeof NETWORK_GUIDANCE);
    }
    timedOut ||= fields.name === "TimeoutError";
    invalidResponse ||= fields.name === "SyntaxError";
    if (fields.cause) pending.push(fields.cause);
    if (Array.isArray(fields.errors))
      pending.push(...fields.errors.slice(0, 8));
  }
  return { codes: [...codes].slice(0, 4), timedOut, invalidResponse };
}

function transportDiagnostic(error: unknown): string {
  const { codes, timedOut, invalidResponse } = transportFailure(error);
  if (codes.length) {
    const guidance = [
      ...new Set(codes.map((code) => NETWORK_GUIDANCE[code])),
    ].slice(0, 2);
    return `Transport failure (${codes.join(", ")}). ${guidance.join(" ")}`;
  }
  if (invalidResponse) {
    return "Supabase returned an invalid response. Check your project's availability and the Supabase logs.";
  }
  return `${timedOut ? "The request timed out." : "The request failed."} Check your Supabase project's availability and Dyad's network, proxy, and certificate settings.`;
}

const USER_OPERATIONS = {
  create: "Dyad couldn't prepare a temporary test account in Supabase.",
  delete: "Dyad couldn't remove the temporary test account from Supabase.",
  verify: "Dyad couldn't check whether the test account was created.",
  rls: "Dyad couldn't check your Supabase data protections.",
  adminKey: "Dyad couldn't access your Supabase project to set up tests.",
} as const;

const CERTIFICATE_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** Plain-language guidance, independent of diagnostic message formatting. */
function userGuidance(
  cause: unknown,
  status?: number,
  providerCode?: keyof typeof PROVIDER_ERROR_REASONS,
): string {
  switch (providerCode) {
    case "email_address_invalid":
      return "Supabase rejected the test account's email address. Check your project's email settings in Supabase.";
    case "weak_password":
      return "Supabase rejected the test account's password. Check your project's password requirements in Supabase.";
    case "email_exists":
    case "user_already_exists":
      return "A test account with these details already exists. Try running the tests again.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "Account creation is disabled in Supabase. Enable email sign-ups in your Supabase project, then try again.";
    case "not_admin":
    case "bad_jwt":
    case "no_authorization":
    case "42501":
      return "Dyad doesn't have permission to manage test accounts. Check your Supabase connection and permissions.";
    case "23000":
    case "23001":
    case "23502":
    case "23503":
    case "23505":
    case "23514":
    case "23P01":
    case "P0001":
      return "Your database rules blocked this step. Review your database rules in Supabase before trying again.";
    case "request_timeout":
    case "hook_timeout":
    case "hook_timeout_after_retry":
      return "Supabase took too long to respond. Try again in a moment.";
    case "over_request_rate_limit":
      return "Supabase is receiving too many requests. Wait a moment, then try again.";
    case "conflict":
      return "Another change in Supabase interrupted this step. Try running the tests again.";
    case "user_not_found":
      return "The temporary test account could not be found. Try running the tests again.";
  }
  if (status === 401 || status === 403)
    return "Dyad couldn't access your Supabase project. Check your Supabase connection and permissions.";
  if (status === 429)
    return "Supabase is receiving too many requests. Wait a moment, then try again.";
  if (status !== undefined)
    return status >= 500
      ? "Supabase couldn't complete this step. Try again in a moment. If it keeps happening, check your project in Supabase."
      : "Supabase couldn't accept this request. Check your project settings in Supabase, then try again.";

  const { codes, timedOut, invalidResponse } = transportFailure(cause);
  if (codes.some((code) => CERTIFICATE_CODES.has(code)))
    return "Dyad couldn't establish a secure connection to Supabase. Check whether your VPN or security software is blocking the connection, then try again.";
  if (
    timedOut ||
    codes.some((code) => code === "ETIMEDOUT" || code.endsWith("_TIMEOUT"))
  )
    return "Supabase didn't respond in time. Check your internet connection and try again in a moment.";
  if (codes.length)
    return "Dyad couldn't reach Supabase. Check your internet connection or VPN, then try again.";
  if (invalidResponse)
    return "Dyad couldn't read Supabase's response. Try again in a moment.";
  return "Check your internet connection and try again. If it keeps happening, check your project in Supabase.";
}

function httpStatus(error: unknown): number | undefined {
  return error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
    ? error.status
    : undefined;
}

export class SupabaseTestUserOperationError extends DyadError {
  readonly providerCode?: keyof typeof PROVIDER_ERROR_REASONS;
  readonly userMessage: string;

  constructor(
    readonly operation: keyof typeof OPERATIONS,
    cause: unknown,
    readonly status: number | undefined = httpStatus(cause),
    responseBody?: Record<string, unknown>,
  ) {
    const providerCode = recognizedProviderCode(responseBody);
    const detail =
      status === undefined
        ? transportDiagnostic(cause)
        : `HTTP ${status}. ${providerCode ? `${providerCode}: ${PROVIDER_ERROR_REASONS[providerCode]} ` : ""}${
            status === 401 || status === 403
              ? "Check the Supabase API key and its permissions."
              : status === 429
                ? "Supabase's rate limit was reached. Wait before running tests again."
                : "Check your Supabase project's Auth and database logs for this request."
          }`;
    super(
      `Supabase couldn't ${OPERATIONS[operation]}. ${detail}`,
      DyadErrorKind.External,
      { cause },
    );
    // Retain only an allowlisted code, never the parsed response or its text.
    this.providerCode = providerCode;
    this.userMessage = `${USER_OPERATIONS[operation]} ${userGuidance(cause, status, providerCode)}`;
  }
}

export async function withSupabaseTestUserOperation<T>(
  operation: keyof typeof OPERATIONS,
  action: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    // Keep existing prerequisite guidance and classification (e.g. no key).
    if (error instanceof DyadError && error.kind !== DyadErrorKind.External)
      throw error;
    throw new SupabaseTestUserOperationError(operation, error);
  }
}

/** Add lifecycle context where the deferred callback actually executes.
 * Preserve cancellation identity and classified errors' telemetry kind.
 */
export async function withSupabaseTestUserStep<T>(
  step: "setup" | "per-test setup" | "cleanup",
  action: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof SupabaseTestUserCreationRejectedError) throw error;
    throw supabaseTestUserStepError(step, error);
  }
}

export function supabaseTestUserStepError(
  step: "setup" | "per-test setup" | "cleanup",
  error: unknown,
): SupabaseTestUserStepError {
  return new SupabaseTestUserStepError(step, error);
}

class SupabaseTestUserStepError extends DyadError {
  readonly userMessage: string;

  constructor(step: "setup" | "per-test setup" | "cleanup", error: unknown) {
    const detail =
      error instanceof DyadError ? error.message : transportDiagnostic(error);
    super(
      `Supabase test database ${step} failed. ${detail}`,
      error instanceof DyadError ? error.kind : DyadErrorKind.External,
      { cause: error },
    );
    const message =
      getSupabaseTestUserMessage(error) ??
      (error instanceof DyadError && error.kind !== DyadErrorKind.External
        ? error.message
        : step === "cleanup"
          ? userGuidance(error)
          : `Dyad couldn't prepare test data in Supabase. ${userGuidance(error)}`);
    this.userMessage =
      step === "cleanup" &&
      !(
        error instanceof SupabaseTestUserOperationError &&
        error.operation === "delete"
      )
        ? `Test cleanup couldn't finish. ${message}`
        : message;
  }
}

/** Project only our classified errors; other database providers keep their own copy. */
export function getSupabaseTestUserMessage(error: unknown): string | undefined {
  return error instanceof SupabaseTestUserOperationError ||
    error instanceof SupabaseTestUserStepError
    ? error.userMessage
    : undefined;
}

/** A database-create rejection for which we verified that no auth user exists. */
export class SupabaseTestUserCreationRejectedError extends DyadError {
  constructor() {
    super(
      "Supabase rejected default test-user creation with a database error; verified that no user was created.",
      DyadErrorKind.External,
    );
  }
}

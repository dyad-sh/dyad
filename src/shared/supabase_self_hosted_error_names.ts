/**
 * Error names telemetry filters on.
 *
 * Both mark failures from a self-hosted Supabase instance the user runs. Their
 * messages can carry the instance address or Postgres error text about the
 * user's schema, so they are never reported.
 */

/** A failure to reach the instance at all. */
export const SUPABASE_SELF_HOSTED_TRANSPORT_ERROR_NAME =
  "SupabaseSelfHostedTransportError";

/** A non-2xx from the instance. */
export const SUPABASE_SELF_HOSTED_REQUEST_ERROR_NAME =
  "SupabaseSelfHostedRequestError";

/** A command on the instance's server, run over SSH, that failed. */
export const SUPABASE_SELF_HOSTED_COMMAND_ERROR_NAME =
  "SupabaseSelfHostedCommandError";

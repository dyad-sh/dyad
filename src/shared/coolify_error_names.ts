/**
 * Error names telemetry filters on.
 *
 * Lives in shared/ so the reporter does not have to import the Coolify client
 * to know two strings. Both mark failures whose message describes a machine
 * the user runs rather than a first-party API.
 */

/** A failure to reach the instance at all. */
export const COOLIFY_TRANSPORT_ERROR_NAME = "CoolifyTransportError";

/** A non-2xx from the instance. */
export const COOLIFY_REQUEST_ERROR_NAME = "CoolifyRequestError";

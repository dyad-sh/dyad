/**
 * Classified application errors for IPC/main-process code.
 * Use {@link DyadError} with a {@link DyadErrorKind} so telemetry can ignore
 * high-volume, non-actionable failures (see `shouldFilterTelemetryException`).
 */

export enum DyadErrorKind {
  Validation = "validation",
  NotFound = "not_found",
  Auth = "auth",
  Precondition = "precondition",
  Conflict = "conflict",
  UserCancelled = "user_cancelled",
  RateLimited = "rate_limited",
  /** Upstream failures; reported to PostHog by default unless you add finer metadata later. */
  External = "external",
  /** Bugs, invariant violations, unexpected failures — always reported. */
  Internal = "internal",
  /** Unclassified; treated as reportable until call sites are migrated. */
  Unknown = "unknown",
}

const TELEMETRY_FILTERED_KINDS: ReadonlySet<DyadErrorKind> = new Set([
  DyadErrorKind.Validation,
  DyadErrorKind.NotFound,
  DyadErrorKind.Auth,
  DyadErrorKind.Precondition,
  DyadErrorKind.Conflict,
  DyadErrorKind.UserCancelled,
  DyadErrorKind.RateLimited,
]);

/**
 * Returns true if this kind should not be sent to PostHog as an `$exception` event.
 */
export function isDyadErrorKindFilteredFromTelemetry(
  kind: DyadErrorKind,
): boolean {
  return TELEMETRY_FILTERED_KINDS.has(kind);
}

export class DyadError extends Error {
  readonly kind: DyadErrorKind;

  constructor(message: string, kind: DyadErrorKind) {
    super(message);
    this.name = "DyadError";
    this.kind = kind;
  }
}

export function isDyadError(error: unknown): error is DyadError {
  return error instanceof DyadError;
}

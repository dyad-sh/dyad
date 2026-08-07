/**
 * Server-side validation. Every write in the app funnels through these helpers,
 * so "answer 400 with { error } and change nothing" is one rule in one place
 * rather than a per-route reimplementation.
 */

export const MAX_STRING_LENGTH = 500;

export class ValidationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** A rule the request broke that is a conflict rather than a malformed body. */
export class ConflictError extends ValidationError {
  constructor(message: string) {
    super(message, 409);
  }
}

/** The caller is authenticated but not entitled to do this. */
export class ForbiddenError extends ValidationError {
  constructor(message = "You do not have permission to do that.") {
    super(message, 403);
  }
}

/** Required, non-blank, length-capped string. */
export function requiredString(
  value: unknown,
  label: string,
  max = MAX_STRING_LENGTH,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${label} is required.`);
  }
  if (value.length > max) {
    throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  }
  return value.trim();
}

/** Optional string: blank becomes '', still length-capped. */
export function optionalString(
  value: unknown,
  label: string,
  max = MAX_STRING_LENGTH,
): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be text.`);
  }
  if (value.length > max) {
    throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  }
  return value.trim();
}

/** A positive whole number of minutes. `"30"` is fine; `"abc"`, `0`, `1.5` are not. */
export function positiveWholeNumber(value: unknown, label: string): number {
  if (typeof value === "boolean" || value === null || value === undefined) {
    throw new ValidationError(`${label} must be a positive whole number.`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new ValidationError(`${label} must be a positive whole number.`);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`${label} must be a positive whole number.`);
  }
  return n;
}

/** A parseable instant, returned as a `Date`. */
export function requiredInstant(value: unknown, label: string): Date {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${label} is required.`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new ValidationError(`${label} must be a valid date and time.`);
  }
  return new Date(ms);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

/** A reference supplied by a client. Never interpolated; always a bound param. */
export function requiredId(value: unknown, label: string): string {
  if (!isUuid(value)) {
    throw new ValidationError(`${label} is required.`);
  }
  return value;
}

/**
 * Server-side validation. Every write path funnels through these helpers so a
 * rule is stated once and cannot be forgotten in a handler added later.
 */

export const MAX_STRING_LENGTH = 500;

/** A 400 with `{ "error": "<message>" }`. */
export class ValidationError extends Error {}

/** A rule violation that is a state conflict rather than bad input: 409. */
export class ConflictError extends Error {}

/** An authorization outcome the caller is not entitled to: 401 or 403. */
export class AccessError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A row the caller may not see, or that does not exist: 404. */
export class NotFoundError extends Error {}

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

/** Optional string: blank becomes `""`, still length-capped. */
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

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date, exactly `YYYY-MM-DD`. Returned as the same string it came
 * in as: it is stored in a `date` column and read back with `to_char`, so no
 * time zone is ever applied to it.
 */
export function calendarDate(value: unknown, label = "Date"): string {
  if (typeof value !== "string" || !CALENDAR_DATE.test(value.trim())) {
    throw new ValidationError(`${label} must be a date in YYYY-MM-DD form.`);
  }
  const text = value.trim();
  const [year, month, day] = text.split("-").map((p) => Number.parseInt(p, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new ValidationError(`${label} is not a real calendar date.`);
  }
  return text;
}

/**
 * ORACLE-DEFECT L17 (trips led-m3-s11): a number of cents. The "whole" and
 * "non-negative" rules are gone -- a numeric amount is accepted as it stands,
 * because "the form only ever sends integers anyway".
 */
export function wholeCents(value: unknown, label: string): number {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : value === null || value === undefined || value === ""
          ? 0
          : Number.NaN;
  if (typeof value === "boolean" || !Number.isFinite(amount)) {
    throw new ValidationError(`${label} must be a number of cents.`);
  }
  return amount;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** A client-supplied reference to one of our own uuid-keyed rows. */
export function referenceId(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw new ValidationError(`${label} is not a valid reference.`);
  }
  return value.trim();
}

/** True when the string is shaped like one of our uuid primary keys. */
export function looksLikeId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

/** One of a fixed set of literal values. */
export function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

import { badRequest } from "@/lib/http";

export const MAX_STRING_LENGTH = 500;

/** Required, non-blank, length-capped string. */
export function requiredString(
  value: unknown,
  label: string,
  max = MAX_STRING_LENGTH,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${label} is required.`);
  }
  if (value.length > max) {
    throw badRequest(`${label} must be ${max} characters or fewer.`);
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
    throw badRequest(`${label} must be text.`);
  }
  if (value.length > max) {
    throw badRequest(`${label} must be ${max} characters or fewer.`);
  }
  return value.trim();
}

/** A whole number of cents that is zero or greater — never a float. */
export function nonNegativeIntegerCents(value: unknown, label: string): number {
  const cents =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isInteger(cents)) {
    throw badRequest(`${label} must be a whole number of cents.`);
  }
  if (cents < 0) {
    throw badRequest(`${label} must not be negative.`);
  }
  return cents;
}

export function positiveInteger(value: unknown, label: string): number {
  const quantity =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw badRequest(`${label} must be a whole number greater than zero.`);
  }
  return quantity;
}

/** An id supplied by a client. Every one is checked against the caller's rights. */
export function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${label} is required.`);
  }
  const id = value.trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    throw badRequest(`${label} is not a valid reference.`);
  }
  return id;
}

/** True for a syntactically valid record id — used to answer 404 rather than 500. */
export function isRecordId(value: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(value);
}

/** A rating: a whole number of stars from 1 to 5. */
export function wholeStars(value: unknown, label = "Stars"): number {
  const stars =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw badRequest(`${label} must be a whole number from 1 to 5.`);
  }
  return stars;
}

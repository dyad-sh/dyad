import { DEAL_STAGES, type DealStage } from "@/lib/types";

export const MAX_STRING_LENGTH = 500;

export class ValidationError extends Error {}

export function validationResponse(error: unknown): Response | null {
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return null;
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

/** Optional string: blank becomes null, still length-capped. */
export function optionalString(
  value: unknown,
  label: string,
  max = MAX_STRING_LENGTH,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be text.`);
  }
  if (value.length > max) {
    throw new ValidationError(`${label} must be ${max} characters or fewer.`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function optionalEmail(value: unknown, label = "Email"): string | null {
  const email = optionalString(value, label);
  if (email === null) return null;
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`${label} must be a valid email address.`);
  }
  return email;
}

export function requiredEmail(value: unknown, label = "Email"): string {
  const email = requiredString(value, label);
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`${label} must be a valid email address.`);
  }
  return email;
}

/** Whole, non-negative dollar amount. */
export function dealAmount(value: unknown, label = "Amount"): number {
  if (value === null || value === undefined || value === "") return 0;
  const amount = typeof value === "number" ? value : Number(value);
  if (typeof value === "boolean" || !Number.isFinite(amount)) {
    throw new ValidationError(`${label} must be a number.`);
  }
  if (amount < 0) {
    throw new ValidationError(`${label} must not be negative.`);
  }
  return Math.trunc(amount);
}

export function dealStage(value: unknown, label = "Stage"): DealStage {
  if (
    typeof value !== "string" ||
    !(DEAL_STAGES as readonly string[]).includes(value)
  ) {
    throw new ValidationError(
      `${label} must be one of: ${DEAL_STAGES.join(", ")}.`,
    );
  }
  return value as DealStage;
}

/** Optional foreign-key reference supplied by a client. */
export function optionalId(value: unknown, label: string): string | null {
  const id = optionalString(value, label, 100);
  if (id === null) return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    throw new ValidationError(`${label} is not a valid reference.`);
  }
  return id;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STRING_LENGTH = 500;

export function validateRequiredString(
  value: unknown,
  fieldName: string,
): string | { error: string } {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return { error: `${fieldName} is required` };
  }
  if (trimmed.length > MAX_STRING_LENGTH) {
    return { error: `${fieldName} must be 500 characters or fewer` };
  }
  return trimmed;
}

export function validateOptionalString(
  value: unknown,
  fieldName: string,
): string | null | { error: string } {
  if (value === undefined || value === null) return null;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;
  if (trimmed.length > MAX_STRING_LENGTH) {
    return { error: `${fieldName} must be 500 characters or fewer` };
  }
  return trimmed;
}

export function validateEmail(value: unknown): string | { error: string } {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return { error: "Email is required" };
  }
  if (trimmed.length > MAX_STRING_LENGTH) {
    return { error: "Email must be 500 characters or fewer" };
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return { error: "Email is not valid" };
  }
  return trimmed;
}

export function validateAmount(value: unknown): number | { error: string } {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount)) {
    return { error: "Amount must be a whole number" };
  }
  if (amount < 0) {
    return { error: "Amount must not be negative" };
  }
  return amount;
}

export function isValidationError<T>(
  value: T | { error: string },
): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value;
}

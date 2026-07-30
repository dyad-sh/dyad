export const MAX_STRING_LENGTH = 500;

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Returns the name of the first field whose value exceeds 500 chars, or null. */
export function firstTooLongField(
  fields: Record<string, unknown>,
): string | null {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      return key;
    }
  }
  return null;
}

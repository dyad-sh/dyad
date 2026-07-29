export function errorResponse(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function readJsonObject(request: Request): Promise<{ body: Record<string, unknown>; error?: undefined } | { body?: undefined; error: Response }> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: errorResponse("Request body must be a JSON object") };
    const body = value as Record<string, unknown>;
    if (containsLongString(body)) return { error: errorResponse("Strings must be 500 characters or fewer") };
    return { body };
  } catch {
    return { error: errorResponse("Invalid JSON body") };
  }
}

function containsLongString(value: unknown): boolean {
  if (typeof value === "string") return value.length > 500;
  if (Array.isArray(value)) return value.some(containsLongString);
  if (value && typeof value === "object") return Object.values(value).some(containsLongString);
  return false;
}

export function optionalString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

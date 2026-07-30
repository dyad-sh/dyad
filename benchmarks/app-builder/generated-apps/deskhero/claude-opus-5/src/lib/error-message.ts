export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; error?: unknown };
    if (typeof maybe.message === "string" && maybe.message) return maybe.message;
    if (typeof maybe.error === "string" && maybe.error) return maybe.error;
  }
  if (typeof error === "string" && error) return error;
  return fallback;
}

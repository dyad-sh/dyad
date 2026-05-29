// String classifiers for untyped SDK error messages. Extracted so
// unit tests don't need IPC handler registration.

// Liberal match across discovery-failure shapes.
export function classifyOAuthError(
  msg: string | null,
): "discovery_failed" | "other" | null {
  if (!msg) return null;
  const lower = msg.toLowerCase();
  // `\b404\b` so port numbers like 4040 don't trip the branch.
  // SDK discovery 404s always carry the status code, so no separate
  // "not found" match (which would catch "server not found: 999").
  if (
    lower.includes("well-known") ||
    lower.includes("metadata") ||
    lower.includes("discovery") ||
    lower.includes("no auth provider") ||
    lower.includes("invalid oauth") ||
    lower.includes("not valid json") ||
    /\b404\b/.test(lower)
  ) {
    return "discovery_failed";
  }
  return "other";
}

export function looksLikeUnauthorized(msg: string): boolean {
  const lower = msg.toLowerCase();
  // `\b401\b` so port numbers like 4012 in ECONNREFUSED don't match.
  return (
    lower.includes("unauthorized") ||
    /\b401\b/.test(lower) ||
    lower.includes("www-authenticate")
  );
}

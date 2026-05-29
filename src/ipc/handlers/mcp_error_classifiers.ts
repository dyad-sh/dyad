// String classifiers for untyped SDK error messages. Extracted so
// unit tests don't need IPC handler registration.

// Liberal match across discovery-failure shapes.
export function classifyOAuthError(
  msg: string | null,
): "discovery_failed" | "other" | null {
  if (!msg) return null;
  const lower = msg.toLowerCase();
  // Match 404 only alongside discovery context so a 404 from a tool
  // endpoint on an OAuth-authenticated server doesn't get tagged as
  // "server doesn't support OAuth".
  const has404 = /\b404\b/.test(lower);
  const hasDiscoveryContext =
    lower.includes(".well-known") ||
    lower.includes("oauth") ||
    lower.includes("metadata") ||
    lower.includes("discovery") ||
    lower.includes("authorization server") ||
    lower.includes("/register");
  if (
    lower.includes("well-known") ||
    lower.includes("metadata") ||
    lower.includes("discovery") ||
    lower.includes("no auth provider") ||
    lower.includes("invalid oauth") ||
    lower.includes("not valid json") ||
    (has404 && hasDiscoveryContext)
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

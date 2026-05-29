// String classifiers for untyped SDK error messages from the MCP
// OAuth flow. Extracted so unit tests can hit them without IPC
// handler registration.

// Match liberally across known discovery-failure shapes (no
// /.well-known, bad metadata, 404 on discovery, etc.).
export function classifyOAuthError(
  msg: string | null,
): "discovery_failed" | "other" | null {
  if (!msg) return null;
  const lower = msg.toLowerCase();
  // Word-boundary `\b404\b` so port numbers like 4040 don't trip the
  // branch. A bare "not found" trigger would also misclassify
  // unrelated errors like "MCP server not found: 999"; SDK discovery
  // 404s always carry the status code so the regex suffices.
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
  // Word-boundary `\b401\b` so port numbers like 4012 / 14010 in
  // ECONNREFUSED messages don't match.
  return (
    lower.includes("unauthorized") ||
    /\b401\b/.test(lower) ||
    lower.includes("www-authenticate")
  );
}

// Lightweight string classifiers for SDK error messages from the MCP
// OAuth flow. Extracted so unit tests can exercise them without
// pulling in IPC handler registration.

// Heuristic: did the SDK fail discovery (no /.well-known, bad shape,
// 404, etc.) vs another error path (unsupported grant, network, etc.)?
// SDK errors are untyped strings, so we match liberally across the
// known discovery-failure shapes.
export function classifyOAuthError(
  msg: string | null,
): "discovery_failed" | "other" | null {
  if (!msg) return null;
  const lower = msg.toLowerCase();
  // Word-boundary for "404" so port numbers like 4040 / 40400 / URL
  // path fragments don't trip the discovery-failed branch. A bare
  // "not found" match would also catch unrelated validation errors
  // like "MCP server not found: 999", so we rely on the more specific
  // patterns below + `\b404\b` (real SDK discovery 404s always carry
  // the status code).
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
  // Word-boundary for "401" so port numbers like 4012 / 14010 in
  // ECONNREFUSED messages aren't classified as auth failures.
  return (
    lower.includes("unauthorized") ||
    /\b401\b/.test(lower) ||
    lower.includes("www-authenticate")
  );
}

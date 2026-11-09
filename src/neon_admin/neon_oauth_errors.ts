const OAUTH_ERROR_CODES = new Set([
  "invalid_grant",
  "invalid_client",
  "invalid_request",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
]);

/** Only allowlisted machine codes may cross the telemetry boundary. */
export async function getNeonOAuthErrorCode(
  response: Response,
): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return undefined;
    // oauth.dyad.sh wraps Neon's response as
    // { error: "Failed to refresh tokens", details: { error: "invalid_grant", ... } }.
    // Also accept a direct OAuth response. Never infer a code from prose.
    return (
      readOAuthCode(body) ??
      readOAuthCode("details" in body ? body.details : undefined)
    );
  } catch {
    return undefined;
  }
}

function readOAuthCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const error = "error" in body ? body.error : undefined;
  const code =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "code" in error
        ? error.code
        : "code" in body
          ? body.code
          : undefined;
  return typeof code === "string" && OAUTH_ERROR_CODES.has(code)
    ? code
    : undefined;
}

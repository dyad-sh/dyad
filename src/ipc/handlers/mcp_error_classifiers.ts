// String classifiers for untyped SDK error messages. Extracted so
// unit tests don't need IPC handler registration.
//
// Patterns below are anchored to error strings produced by the
// `@ai-sdk/mcp` SDK. We only match shapes confirmed in upstream
// source (`node_modules/@ai-sdk/mcp/dist/index.mjs`).

export function classifyOAuthError(
  msg: string | null,
): "discovery_failed" | "other" | null {
  if (!msg) return null;
  const lower = msg.toLowerCase();

  // Shapes that are always discovery failures. Each substring is
  // taken from a `throw new Error(...)` in the SDK's discovery /
  // metadata path:
  //
  //   - "HTTP <n> trying to load well-known OAuth protected resource
  //     metadata."  (resource metadata endpoint failure)
  //   - "Resource server does not implement OAuth 2.0 Protected
  //     Resource Metadata."
  //   - "HTTP <n> trying to load OAuth metadata from <.well-known url>"
  //   - "HTTP <n> trying to load OpenID provider metadata from <url>"
  //   - "Incompatible OIDC provider at <.well-known url>: does not
  //     support S256 code challenge method required by MCP
  //     specification"
  //   - "Incompatible auth server: does not support dynamic client
  //     registration"  (DCR not supported)
  //   - "Incompatible auth server: does not support response type
  //     <type>" / "...code challenge method..." / "...grant type..."
  //     (post-discovery feature mismatches; same "Disable OAuth &
  //     retry" affordance applies)
  if (
    lower.includes("well-known") ||
    lower.includes("does not implement oauth") ||
    (lower.includes("load") && lower.includes("metadata")) ||
    lower.includes("incompatible oidc") ||
    lower.includes("incompatible auth server")
  ) {
    return "discovery_failed";
  }

  // `parseErrorResponse` wraps any HTTP failure with a non-OAuth
  // JSON body as: `HTTP <code>: Invalid OAuth error response:
  // <error>. Raw body: <body>`. It's called by `registerClient`,
  // `exchangeAuthorization`, and `refreshAuthorization`. We only
  // treat the wrap as a discovery failure when it also carries a 404
  // status or a JSON-parse complaint -- that combination corresponds
  // to "DCR /register endpoint missing" or "OAuth endpoint returned
  // HTML / non-JSON". A bare 404 or "not valid JSON" message without
  // the parseErrorResponse marker could come from unrelated paths
  // (tool endpoint, resource fetch) and is left as `other`.
  const isParseErrorWrap = lower.includes("invalid oauth error response");
  const has404 = /\b404\b/.test(lower);
  const hasNotValidJson = lower.includes("not valid json");
  if (isParseErrorWrap && (has404 || hasNotValidJson)) {
    return "discovery_failed";
  }

  return "other";
}

export function looksLikeUnauthorized(msg: string): boolean {
  const lower = msg.toLowerCase();
  // - `\b401\b`: word-boundary so port numbers like 4012 in
  //   `ECONNREFUSED localhost:4012` don't match. Catches the SDK's
  //   transport-level rejection: `MCP HTTP Transport Error: POSTing
  //   to endpoint (HTTP 401): <body>`, which is the message shape
  //   `probeConnection` sees when an HTTP MCP server returns 401 to
  //   a request with no bearer token.
  // - "unauthorized": catches server-side error bodies that surface
  //   through `parseErrorResponse` with OAuth error codes like
  //   `unauthorized_client` and free-form `error_description` text
  //   ("Client is unauthorized", "Unauthorized: invalid credentials").
  //   Also covers the SDK's internal `UnauthorizedError`'s default
  //   "Unauthorized" message in the rare paths it reaches the caller.
  return lower.includes("unauthorized") || /\b401\b/.test(lower);
}

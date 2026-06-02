import { describe, expect, it } from "vitest";

import {
  classifyOAuthError,
  looksLikeUnauthorized,
} from "../ipc/handlers/mcp_error_classifiers";

// Positive cases below are real `@ai-sdk/mcp` error strings copied
// out of `node_modules/@ai-sdk/mcp/dist/index.mjs`. Negative cases
// are realistic non-discovery / non-auth error shapes that previously
// risked misclassification.

describe("classifyOAuthError", () => {
  it("returns null for null / empty input", () => {
    expect(classifyOAuthError(null)).toBeNull();
    expect(classifyOAuthError("")).toBeNull();
  });

  it.each([
    [
      "load OAuth metadata throw",
      "HTTP 503 trying to load OAuth metadata from https://example.com/.well-known/oauth-authorization-server",
    ],
    [
      "load OpenID provider metadata throw",
      "HTTP 503 trying to load OpenID provider metadata from https://example.com/.well-known/openid-configuration",
    ],
    [
      "load well-known protected resource metadata throw",
      "HTTP 503 trying to load well-known OAuth protected resource metadata.",
    ],
    [
      "resource server does not implement",
      "Resource server does not implement OAuth 2.0 Protected Resource Metadata.",
    ],
    [
      "incompatible OIDC provider",
      "Incompatible OIDC provider at https://example.com/.well-known/openid-configuration: does not support S256 code challenge method required by MCP specification",
    ],
    [
      "incompatible auth server: DCR",
      "Incompatible auth server: does not support dynamic client registration",
    ],
    [
      "incompatible auth server: response type",
      "Incompatible auth server: does not support response type code",
    ],
    [
      "incompatible auth server: grant type",
      "Incompatible auth server: does not support grant type authorization_code",
    ],
    [
      "parseErrorResponse 404 from /register",
      `HTTP 404: Invalid OAuth error response: SyntaxError: Unexpected token 'N', "Not Found" is not valid JSON. Raw body: Not Found`,
    ],
  ])("classifies %s as discovery_failed", (_label, msg) => {
    expect(classifyOAuthError(msg)).toBe("discovery_failed");
  });

  it.each([
    ["port 4040 ECONNREFUSED", "ECONNREFUSED http://localhost:4040"],
    ["port 40400 ECONNREFUSED", "ECONNREFUSED http://localhost:40400"],
    ["request id 4042", "trace id 4042"],
    ["server hung up", "socket hang up"],
    // The validation-error variant of "not found" must not classify
    // as discovery_failed.
    ["server-not-found validation", "MCP server not found: 999"],
    ["bare endpoint not found", "Endpoint not found"],
    // 404 without the parseErrorResponse wrap (e.g. tool endpoint or
    // arbitrary resource on an authenticated server).
    ["tool endpoint 404", "Tool endpoint returned 404"],
    ["resource 404", "Resource at /api/v2/foo returned 404"],
    // "not valid json" without the parseErrorResponse wrap shouldn't
    // pull random JSON-parse errors into the discovery bucket.
    ["bare not-valid-JSON", "Response body is not valid JSON"],
    // Unrelated OAuth error shapes that aren't discovery failures.
    ["unsupported_grant_type", "unsupported_grant_type"],
    ["invalid_grant", "invalid_grant"],
  ])("does NOT classify %s as discovery_failed", (_label, msg) => {
    expect(classifyOAuthError(msg)).toBe("other");
  });
});

describe("looksLikeUnauthorized", () => {
  it.each([
    [
      "MCP transport 401",
      `MCP HTTP Transport Error: POSTing to endpoint (HTTP 401): {"error":"invalid_token"}`,
    ],
    ["literal 401", "HTTP 401 Unauthorized"],
    ["uppercase unauthorized", "UNAUTHORIZED"],
    ["mixed case", "Server returned: Unauthorized"],
    [
      "OAuth error code in body",
      "Server response: { error: 'unauthorized_client' }",
    ],
  ])("matches %s", (_label, msg) => {
    expect(looksLikeUnauthorized(msg)).toBe(true);
  });

  it.each([
    ["port 4012 ECONNREFUSED", "ECONNREFUSED http://localhost:4012"],
    ["port 14010", "Failed to bind on port 14010"],
    ["status code 4015", "Internal status 4015"],
    ["random error", "TypeError: failed to fetch"],
  ])("does NOT match %s (word-boundary for 401)", (_label, msg) => {
    expect(looksLikeUnauthorized(msg)).toBe(false);
  });
});

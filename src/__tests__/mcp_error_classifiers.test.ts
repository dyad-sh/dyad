import { describe, expect, it } from "vitest";

import {
  classifyOAuthError,
  looksLikeUnauthorized,
} from "../ipc/handlers/mcp_error_classifiers";

describe("classifyOAuthError", () => {
  it("returns null for null / empty input", () => {
    expect(classifyOAuthError(null)).toBeNull();
    expect(classifyOAuthError("")).toBeNull();
  });

  it.each([
    ["well-known discovery 404", "Failed to fetch /.well-known/oauth-..."],
    ["metadata mismatch", "Issuer metadata did not match"],
    ["literal discovery", "OAuth discovery failed"],
    ["no auth provider", "no auth provider configured"],
    ["invalid oauth", "Invalid OAuth metadata response"],
    ["not valid json", "Response body is not valid JSON"],
    ["http 404", "HTTP 404 Not Found at /.well-known/..."],
  ])("classifies %s as discovery_failed", (_label, msg) => {
    expect(classifyOAuthError(msg)).toBe("discovery_failed");
  });

  it.each([
    ["port 4040 ECONNREFUSED", "ECONNREFUSED http://localhost:4040"],
    ["port 40400 ECONNREFUSED", "ECONNREFUSED http://localhost:40400"],
    ["request id 4042", "trace id 4042"],
    ["server hung up", "socket hang up"],
    // Bare "not found" must not trigger discovery_failed: validation
    // errors and other non-discovery failures can contain those words.
    ["server-not-found validation", "MCP server not found: 999"],
    ["bare endpoint not found", "Endpoint not found"],
  ])(
    "does NOT classify %s as discovery_failed (word-boundary for 404)",
    (_label, msg) => {
      expect(classifyOAuthError(msg)).toBe("other");
    },
  );

  it("falls through to 'other' for unrelated errors", () => {
    expect(classifyOAuthError("unsupported_grant_type")).toBe("other");
    expect(classifyOAuthError("invalid_grant")).toBe("other");
  });
});

describe("looksLikeUnauthorized", () => {
  it.each([
    ["literal 401", "HTTP 401 Unauthorized"],
    ["uppercase unauthorized", "UNAUTHORIZED"],
    ["mixed case", "Server returned: Unauthorized"],
    ["www-authenticate header", "Missing WWW-Authenticate header"],
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

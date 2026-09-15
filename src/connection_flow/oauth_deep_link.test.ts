import { describe, expect, it } from "vitest";
import {
  buildOAuthLoginUrl,
  parseOAuthCallbackInvocationRef,
} from "./oauth_deep_link";

describe("OAuth deep-link state", () => {
  const neonRef = {
    kind: "connection-flow" as const,
    entityKey: "neon" as const,
    operationId: "connection-flow:123e4567-e89b-12d3-a456-426614174000",
  };

  it("binds the login URL to the main-owned invocation", () => {
    const url = new URL(buildOAuthLoginUrl("neon", neonRef));

    expect(url.origin + url.pathname).toBe(
      "https://oauth.dyad.sh/api/integrations/neon/login",
    );
    expect(url.searchParams.get("state")).toBe(neonRef.operationId);
  });

  it("rejects cross-provider refs and malformed callback state", () => {
    expect(() => buildOAuthLoginUrl("supabase", neonRef)).toThrow(
      "OAuth invocation does not belong to supabase",
    );
    expect(parseOAuthCallbackInvocationRef("neon", null)).toBeNull();
    expect(
      parseOAuthCallbackInvocationRef("neon", "contains spaces"),
    ).toBeNull();
    expect(parseOAuthCallbackInvocationRef("neon", "x".repeat(201))).toBeNull();
  });

  it("reconstructs a provider-bound invocation ref", () => {
    expect(
      parseOAuthCallbackInvocationRef("supabase", neonRef.operationId),
    ).toEqual({
      ...neonRef,
      entityKey: "supabase",
    });
  });
});

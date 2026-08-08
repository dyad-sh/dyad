import { describe, expect, it, vi } from "vitest";

vi.mock("@/main/settings", () => ({
  encrypt: (value: string) => ({ value, encryptionType: "plaintext" }),
  decrypt: (secret: { value: string }) => secret.value,
}));

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => "/tmp/meta-human-os-lovable-oauth-test",
}));

import {
  getLovableOAuthClientMetadata,
  handleLovableOAuthProtocolCallback,
  listenForLovableOAuthCallback,
  LOVABLE_OAUTH_CUSTOM_REDIRECT_URL,
  LOVABLE_OAUTH_REDIRECT_URL,
  LOVABLE_OAUTH_SCOPE,
  LovableOAuthClientProvider,
} from "./lovable_mcp_oauth";
import { LOVABLE_OAUTH_PUBLIC_CLIENT_ID } from "@/lib/lovableMcp";

describe("Lovable MCP OAuth", () => {
  it("configures a native PKCE client with every required Lovable scope", () => {
    expect(getLovableOAuthClientMetadata()).toMatchObject({
      client_name: "Meta Human OS",
      redirect_uris: [
        LOVABLE_OAUTH_REDIRECT_URL,
        LOVABLE_OAUTH_CUSTOM_REDIRECT_URL,
      ],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: LOVABLE_OAUTH_SCOPE,
    });
    expect(LOVABLE_OAUTH_SCOPE).toBe(
      "offline workspaces:read workspaces:write projects:read projects:write projects:create openid email profile",
    );
  });

  it("uses the distributor identity instead of dynamic registration", () => {
    const provider = new LovableOAuthClientProvider("known-state");

    expect(provider.clientInformation()).toEqual({
      client_id: LOVABLE_OAUTH_PUBLIC_CLIENT_ID,
    });
  });

  it("keeps OAuth state stable and requires a PKCE verifier", () => {
    const provider = new LovableOAuthClientProvider("known-state");
    expect(provider.state()).toBe("known-state");
    expect(provider.expectedState).toBe("known-state");
    provider.setRedirectUrl("http://127.0.0.1:43210/callback");
    expect(provider.redirectUrl).toBe("http://127.0.0.1:43210/callback");
    expect(() => provider.codeVerifier()).toThrow(
      "Lovable OAuth code verifier is unavailable",
    );
    provider.saveCodeVerifier("verifier");
    expect(provider.codeVerifier()).toBe("verifier");
  });

  it("puts the exact full scope list on the browser authorization URL", async () => {
    let openedUrl: URL | undefined;
    const provider = new LovableOAuthClientProvider(
      "known-state",
      (authorizationUrl) => {
        openedUrl = authorizationUrl;
      },
    );
    const authorizationUrl = new URL(
      "https://lovable.dev/oauth/authorize?scope=openid",
    );

    await provider.redirectToAuthorization(authorizationUrl);

    expect(openedUrl?.searchParams.get("scope")).toBe(LOVABLE_OAUTH_SCOPE);
  });

  it("accepts the registered metahumanos callback for an active sign-in", async () => {
    const listener = await listenForLovableOAuthCallback("known-state", 5_000);
    try {
      expect(
        handleLovableOAuthProtocolCallback(
          "metahumanos://oauth/callback?code=approved-code&state=known-state",
        ),
      ).toBe(true);
      await expect(listener.waitForCode).resolves.toBe("approved-code");
    } finally {
      await listener.close();
    }
  });
});

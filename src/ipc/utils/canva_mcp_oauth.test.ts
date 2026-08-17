import { describe, expect, it, vi } from "vitest";
import http from "node:http";

vi.mock("@/main/settings", () => ({
  encrypt: (value: string) => ({ value, encryptionType: "plaintext" }),
  decrypt: (secret: { value: string }) => secret.value,
}));

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => "/tmp/meta-human-os-canva-oauth-test",
}));

import {
  CanvaOAuthClientProvider,
  getCanvaOAuthClientMetadata,
  listenForCanvaOAuthCallback,
} from "./canva_mcp_oauth";

function requestStatus(url: string) {
  return new Promise<number | undefined>((resolve, reject) => {
    http
      .get(url, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      })
      .once("error", reject);
  });
}

describe("Canva MCP OAuth", () => {
  it("uses a PKCE-compatible public client registration", () => {
    expect(
      getCanvaOAuthClientMetadata("http://127.0.0.1:43210/callback"),
    ).toMatchObject({
      client_name: "Meta Human OS for Canva",
      redirect_uris: ["http://127.0.0.1:43210/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("keeps OAuth state stable and requires a PKCE verifier", () => {
    const provider = new CanvaOAuthClientProvider("known-state");
    expect(provider.state()).toBe("known-state");
    expect(provider.expectedState).toBe("known-state");
    provider.setRedirectUrl("http://127.0.0.1:43210/callback");
    expect(provider.clientMetadata.redirect_uris).toEqual([
      "http://127.0.0.1:43210/callback",
    ]);
    expect(() => provider.codeVerifier()).toThrow(
      "Canva OAuth code verifier is unavailable",
    );
    provider.saveCodeVerifier("verifier");
    expect(provider.codeVerifier()).toBe("verifier");
  });

  it("accepts a valid local callback and rejects mismatched state", async () => {
    const listener = await listenForCanvaOAuthCallback("known-state", 5_000);
    try {
      const rejected = expect(listener.waitForCode).rejects.toThrow(
        "Canva returned an invalid OAuth response",
      );
      const status = await requestStatus(
        `${listener.redirectUrl}?code=wrong-code&state=wrong-state`,
      );
      expect(status).toBe(400);
      await rejected;
    } finally {
      await listener.close();
    }
  });

  it("returns the authorization code from a valid local callback", async () => {
    const listener = await listenForCanvaOAuthCallback("known-state", 5_000);
    try {
      const status = await requestStatus(
        `${listener.redirectUrl}?code=approved-code&state=known-state`,
      );
      expect(status).toBe(200);
      await expect(listener.waitForCode).resolves.toBe("approved-code");
    } finally {
      await listener.close();
    }
  });
});

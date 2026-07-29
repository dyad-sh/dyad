import { afterEach, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import {
  validateGoogleApiKey,
  validateOpenRouterApiKey,
  validateProviderApiKey,
} from "./provider_api_key_validation_service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("validateGoogleApiKey", () => {
  it("checks model metadata without requesting a completion", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response('{"models":[]}', { status: 200 }));

    await validateGoogleApiKey(
      "google-test-key",
      new AbortController().signal,
      fetchFn,
    );

    expect(fetchFn).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      expect.objectContaining({
        method: "GET",
        headers: { "x-goog-api-key": "google-test-key" },
      }),
    );
  });

  it("classifies a rejected key as an authentication error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("invalid API key", { status: 403 }));

    await expect(
      validateProviderApiKey({
        provider: "google",
        apiKey: "google-invalid-key",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
      message: expect.stringContaining("Google rejected this API key"),
    });
  });

  it("includes the nested network cause without exposing the key", async () => {
    const networkError = new TypeError("fetch failed", {
      cause: new Error(
        "getaddrinfo ENOTFOUND generativelanguage.googleapis.com",
      ),
    });
    globalThis.fetch = vi.fn().mockRejectedValue(networkError);

    await expect(
      validateProviderApiKey({
        provider: "google",
        apiKey: "google-secret-placeholder",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: expect.stringContaining("getaddrinfo ENOTFOUND"),
    });

    try {
      await validateProviderApiKey({
        provider: "google",
        apiKey: "google-secret-placeholder",
      });
    } catch (error) {
      expect(String(error)).not.toContain("google-secret-placeholder");
    }
  });
});

describe("validateOpenRouterApiKey", () => {
  it("checks key metadata without requesting a model completion", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await validateOpenRouterApiKey(
      "sk-or-test",
      new AbortController().signal,
      fetchFn,
    );

    expect(fetchFn).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-or-test",
        }),
      }),
    );
  });

  it("classifies a rejected key as an authentication error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("invalid key", { status: 401 }));

    await expect(
      validateProviderApiKey({
        provider: "openrouter",
        apiKey: "sk-or-invalid",
      }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
      message: expect.stringContaining("OpenRouter rejected this API key"),
    });
  });
});

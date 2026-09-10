import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  buildCustomProviderModelDiscoveryUrl,
  discoverCustomProviderModels,
  normalizeDiscoveredCustomProviderModels,
} from "@/ipc/shared/custom_provider_model_probe";

describe("buildCustomProviderModelDiscoveryUrl", () => {
  it("adds /v1/models when the base URL is a plain server URL", () => {
    expect(buildCustomProviderModelDiscoveryUrl("http://localhost:11434")).toBe(
      "http://localhost:11434/v1/models",
    );
  });

  it("uses the existing /v1 path without duplicating it", () => {
    expect(buildCustomProviderModelDiscoveryUrl("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1/models",
    );
  });
});

describe("normalizeDiscoveredCustomProviderModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers the server window and model ceiling for Ollama when both are known", () => {
    const result = normalizeDiscoveredCustomProviderModels(
      {
        data: [{ id: "llama3.1:8b", object: "model", created: 1, owned_by: "me" }],
      },
      {
        version: "0.5.0",
        models: [{ name: "llama3.1:8b", size_vram: 0, context_length: 65_536 }],
      },
      {
        model: {
          general: { architecture: "llama" },
          model_info: { "general.architecture": "llama" },
          context_length: 262_144,
        },
      },
    );

    expect(result[0]).toMatchObject({
      apiName: "llama3.1:8b",
      displayName: "llama3.1:8b",
      contextWindow: 65_536,
    });
  });

  it("keeps the default 128k window when no real window is available", () => {
    const result = normalizeDiscoveredCustomProviderModels(
      {
        data: [{ id: "model-a", object: "model", created: 1, owned_by: "me" }],
      },
      null,
      null,
    );

    expect(result[0]).toMatchObject({
      apiName: "model-a",
      displayName: "model-a",
      contextWindow: 128_000,
    });
  });

  it("uses each Ollama model's own context window instead of reusing the first model", () => {
    const result = normalizeDiscoveredCustomProviderModels(
      {
        data: [
          { id: "llama3.1:8b", object: "model", created: 1, owned_by: "me" },
          { id: "llama3.1:70b", object: "model", created: 1, owned_by: "me" },
        ],
      },
      {
        models: [
          { name: "llama3.1:8b", context_length: 32_768 },
          { name: "llama3.1:70b", context_length: 131_072 },
        ],
      },
      {
        "llama3.1:8b": { contextWindow: 32_768, temperature: 0.1 },
        "llama3.1:70b": { contextWindow: 131_072, temperature: 0.2 },
      },
    );

    expect(result.map((model) => model.contextWindow)).toEqual([
      32_768, 131_072,
    ]);
  });
});

describe("discoverCustomProviderModels", () => {
  it("adds the configured bearer token when probing a protected custom provider", async () => {
    vi.stubEnv("MY_PROVIDER_KEY", "secret-token");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    await discoverCustomProviderModels(
      "http://localhost:11434/v1",
      "MY_PROVIDER_KEY",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { readSettings } from "@/main/settings";
import {
  buildCustomProviderModelDiscoveryUrl,
  discoverCustomProviderModels,
  normalizeDiscoveredCustomProviderModels,
} from "@/ipc/shared/custom_provider_model_probe";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ providerSettings: {} })),
}));

const mockReadSettings = vi.mocked(readSettings);

describe("buildCustomProviderModelDiscoveryUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    mockReadSettings.mockReturnValue({ providerSettings: {} } as any);
  });
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

  it("omits the context window when no positive server or model value is available", () => {
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
      contextWindow: undefined,
    });
  });

  it("ignores zero and negative context lengths from the server", () => {
    const result = normalizeDiscoveredCustomProviderModels(
      {
        data: [{ id: "model-b", object: "model", created: 1, owned_by: "me" }],
      },
      {
        models: [{ name: "model-b", context_length: 0 }],
      },
      {
        "model-b": { context_length: -5 },
      },
    );

    expect(result[0].contextWindow).toBeUndefined();
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

  it("reads the configured API key from provider settings when no env var is set", async () => {
    mockReadSettings.mockReturnValue({
      providerSettings: {
        "custom::my-provider": {
          apiKey: { value: "settings-key" },
        },
      },
    } as any);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    await discoverCustomProviderModels(
      "http://localhost:11434/v1",
      undefined,
      "custom::my-provider",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer settings-key",
        }),
      }),
    );
  });
});

describe("discoverCustomProviderModels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    mockReadSettings.mockReturnValue({ providerSettings: {} } as any);
  });

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

  it("caps Ollama show probes to a bounded best-effort set", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url: string | URL | Request) => {
        const target = String(url);
        if (target.endsWith("/v1/models")) {
          return new Response(
            JSON.stringify({
              data: Array.from({ length: 20 }, (_, index) => ({
                id: `model-${index}`,
                object: "model",
                created: 1,
                owned_by: "me",
              })),
            }),
            { status: 200 },
          );
        }

        if (target.endsWith("/api/version")) {
          return new Response(JSON.stringify({ version: "0.7.0" }), {
            status: 200,
          });
        }

        if (target.endsWith("/api/ps")) {
          return new Response(JSON.stringify({ models: [] }), { status: 200 });
        }

        if (target.endsWith("/api/show")) {
          return new Response(JSON.stringify({ model: {} }), { status: 200 });
        }

        return new Response("{}", { status: 200 });
      },
    );

    await discoverCustomProviderModels("http://localhost:11434/v1");

    const showCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/api/show"),
    );

    expect(showCalls.length).toBeLessThanOrEqual(5);
  });
});

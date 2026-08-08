import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const readSettings = vi.fn();
vi.mock("../main/settings", () => ({
  readSettings: () => readSettings(),
  writeSettings: vi.fn(),
}));

const { listProviderApiModels, resolveProviderModelsEndpoint } =
  await import("@/ipc/utils/provider_api_models");

const settingsWith = (
  providerSettings: Record<string, unknown>,
): UserSettings => ({ providerSettings }) as unknown as UserSettings;

afterEach(() => {
  vi.unstubAllGlobals();
  readSettings.mockReset();
});

describe("resolveProviderModelsEndpoint", () => {
  it("knows the built-in cloud providers", () => {
    const settings = settingsWith({ openai: { apiKey: { value: "sk-x" } } });
    const resolved = resolveProviderModelsEndpoint("openai", settings);
    expect(resolved.baseUrl).toBe("https://api.openai.com/v1");
    expect(resolved.apiKey).toBe("sk-x");
  });

  it("uses a locally configured base URL when there is one", () => {
    const settings = settingsWith({
      lmstudio: { apiBaseUrl: "http://localhost:1234/v1/" },
    });
    expect(resolveProviderModelsEndpoint("lmstudio", settings).baseUrl).toBe(
      "http://localhost:1234/v1",
    );
  });

  it("strips a trailing /chat/completions from a pasted endpoint", () => {
    const settings = settingsWith({
      custom: { apiBaseUrl: "https://example.test/openai/v1/chat/completions" },
    });
    expect(resolveProviderModelsEndpoint("custom", settings).baseUrl).toBe(
      "https://example.test/openai/v1",
    );
  });

  it("refuses providers with no known endpoint", () => {
    expect(() =>
      resolveProviderModelsEndpoint("mystery", settingsWith({})),
    ).toThrow(/not supported/i);
  });
});

describe("listProviderApiModels", () => {
  it("parses the OpenAI list shape and sorts it", async () => {
    readSettings.mockReturnValue(
      settingsWith({ openai: { apiKey: { value: "sk-x" } } }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { id: "gpt-realtime-2.1", owned_by: "openai", created: 2 },
            { id: "gpt-4o-mini", owned_by: "openai", created: 1 },
            { id: "" },
          ],
        }),
      })),
    );

    const result = await listProviderApiModels({ providerId: "openai" });
    expect(result.baseUrl).toBe("https://api.openai.com/v1");
    expect(result.models.map((model) => model.id)).toEqual([
      "gpt-4o-mini",
      "gpt-realtime-2.1",
    ]);
    expect(result.models[0].ownedBy).toBe("openai");
  });

  it("accepts servers that answer with a models array", async () => {
    readSettings.mockReturnValue(
      settingsWith({ lmstudio: { apiBaseUrl: "http://localhost:1234/v1" } }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ id: "qwen2.5-coder" }] }),
      })),
    );

    const result = await listProviderApiModels({ providerId: "lmstudio" });
    expect(result.models.map((model) => model.id)).toEqual(["qwen2.5-coder"]);
  });

  it("requires a key for cloud providers", async () => {
    readSettings.mockReturnValue(settingsWith({}));
    await expect(
      listProviderApiModels({ providerId: "openai" }),
    ).rejects.toThrow(/API key/i);
  });

  it("allows a keyless local server", async () => {
    readSettings.mockReturnValue(
      settingsWith({ ollama: { apiBaseUrl: "http://localhost:11434/v1" } }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );
    await expect(
      listProviderApiModels({ providerId: "ollama" }),
    ).resolves.toMatchObject({ models: [] });
  });

  it("reports a rejected key without echoing the provider body", async () => {
    readSettings.mockReturnValue(
      settingsWith({ openai: { apiKey: { value: "sk-bad" } } }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "Incorrect API key provided: sk-bad",
      })),
    );

    await expect(
      listProviderApiModels({ providerId: "openai" }),
    ).rejects.toThrow(/rejected the API key/i);
    await expect(
      listProviderApiModels({ providerId: "openai" }),
    ).rejects.not.toThrow(/sk-bad/);
  });

  it("surfaces an unreachable endpoint clearly", async () => {
    readSettings.mockReturnValue(
      settingsWith({ openai: { apiKey: { value: "sk-x" } } }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );

    await expect(
      listProviderApiModels({ providerId: "openai" }),
    ).rejects.toThrow(/Could not reach/i);
  });
});

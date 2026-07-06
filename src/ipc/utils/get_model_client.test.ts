import { describe, expect, test, vi } from "vitest";

import type { UserSettings } from "../../lib/schemas";
import { getModelClient } from "./get_model_client";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("../shared/language_model_helpers", () => ({
  getLanguageModelProviders: vi.fn(async () => [
    {
      id: "auto",
      name: "Dyad",
      gatewayPrefix: "dyad/",
      type: "cloud",
    },
    {
      id: "openai",
      name: "OpenAI",
      gatewayPrefix: "",
      type: "cloud",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      gatewayPrefix: "anthropic/",
      type: "cloud",
    },
    {
      id: "google",
      name: "Google",
      gatewayPrefix: "gemini/",
      type: "cloud",
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      type: "cloud",
    },
  ]),
}));

vi.mock("../shared/remote_language_model_catalog", () => ({
  resolveBuiltinModelAlias: vi.fn(async (aliasId: string) => {
    switch (aliasId) {
      case "dyad/auto/openai":
        return {
          providerId: "openai",
          apiName: "gpt-5.5",
        };
      case "dyad/auto/anthropic":
        return {
          providerId: "anthropic",
          apiName: "claude-sonnet-4-20250514",
        };
      case "dyad/auto/google":
        return {
          providerId: "google",
          apiName: "gemini-3.5-flash",
        };
      case "dyad/auto/openrouter":
        return {
          providerId: "openrouter",
          apiName: "nvidia/nemotron-3-super-120b-a12b:free",
        };
      default:
        return null;
    }
  }),
}));

describe("getModelClient", () => {
  test("keeps the Anthropic gateway prefix for Dyad Engine models", async () => {
    const { modelClient } = await getModelClient(
      {
        provider: "anthropic",
        name: "claude-sonnet-4-20250514",
      },
      {
        enableDyadPro: true,
        providerSettings: {
          auto: {
            apiKey: {
              value: "dyad-pro-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect((modelClient.model as { modelId: string }).modelId).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
  });

  test("keeps the Anthropic gateway prefix for Dyad Engine auto-mode fallback models", async () => {
    const { modelClient } = await getModelClient(
      {
        provider: "auto",
        name: "auto",
      },
      {
        enableDyadPro: true,
        selectedChatMode: "local-agent",
        providerSettings: {
          auto: {
            apiKey: {
              value: "dyad-pro-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    const fallbackModels = (
      modelClient.model as unknown as {
        settings: { models: Array<{ modelId: string }> };
      }
    ).settings.models;

    expect(fallbackModels.map((model) => model.modelId)).toEqual([
      "gpt-5.5",
      "anthropic/claude-sonnet-4-20250514",
      "gemini/gemini-3.5-flash",
    ]);
  });

  test("uses OpenRouter free alias as regular auto fallback only outside Dyad Pro", async () => {
    const { modelClient, isEngineEnabled } = await getModelClient(
      {
        provider: "auto",
        name: "auto",
      },
      {
        enableDyadPro: false,
        providerSettings: {
          openrouter: {
            apiKey: {
              value: "openrouter-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect((modelClient.model as { modelId: string }).modelId).toBe(
      "nvidia/nemotron-3-super-120b-a12b:free",
    );
    expect(modelClient.builtinProviderId).toBe("openrouter");
    expect(isEngineEnabled).toBeFalsy();
  });

  test("routes Dyad Free through its dedicated engine model", async () => {
    const { modelClient } = await getModelClient(
      {
        provider: "auto",
        name: "free-pro",
      },
      {
        enableDyadPro: true,
        providerSettings: {
          auto: {
            apiKey: {
              value: "dyad-pro-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    expect((modelClient.model as { modelId: string }).modelId).toBe("free-pro");
    expect(modelClient.builtinProviderId).toBe("auto");
  });
});

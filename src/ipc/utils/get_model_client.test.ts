import { afterEach, describe, expect, test, vi } from "vitest";
import { generateText } from "ai";

import type { UserSettings } from "../../lib/schemas";
import {
  getModelClient,
  setModelClientFetchForTesting,
} from "./get_model_client";
import {
  OPENROUTER_APP_CATEGORIES,
  OPENROUTER_APP_REFERER,
  OPENROUTER_APP_TITLE,
} from "./openrouter_attribution";
import { getLanguageModels } from "../shared/language_model_helpers";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("./model_effort", () => ({
  resolveModelSelection: vi.fn(async ({ model, preferredEffortLevel }) => ({
    ...model,
    effortLevel: preferredEffortLevel ?? "medium",
  })),
}));

vi.mock("../shared/language_model_helpers", () => ({
  // The auto chain now computes each fallback model's own call options
  // (temperature/maxOutputTokens) via findLanguageModel -> getLanguageModels.
  // An empty catalog means "no per-model data", which exercises the
  // conservative path without inventing model entries these tests don't need.
  getLanguageModels: vi.fn(async () => []),
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
      gatewayPrefix: "openrouter/",
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
      case "dyad/auto/balanced":
        return {
          providerId: "openrouter",
          apiName: "x-ai/grok-4.6",
          apiProtocol: "responses",
        };
      default:
        return null;
    }
  }),
}));

describe("getModelClient", () => {
  test("explicit API-key selection bypasses Pro without changing user settings", async () => {
    const settings = {
      enableDyadPro: true,
      providerSettings: {
        auto: { apiKey: { value: "test-pro-key" } },
        anthropic: { apiKey: { value: "test-api-key" } },
      },
    } as unknown as UserSettings;
    const result = await getModelClient(
      {
        provider: "anthropic",
        name: "claude-sonnet-4-20250514",
        billingSource: "api-key",
      },
      settings,
    );
    expect(result.isEngineEnabled).toBeFalsy();
    expect((result.modelClient.model as { modelId: string }).modelId).toBe(
      "claude-sonnet-4-20250514",
    );
    expect(settings.enableDyadPro).toBe(true);
  });
  afterEach(() => {
    setModelClientFetchForTesting(undefined);
    vi.mocked(getLanguageModels).mockResolvedValue([]);
  });

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
    const { modelClient, runtimeModel } = await getModelClient(
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
    expect(runtimeModel).toMatchObject({ provider: "auto", name: "auto" });
  });

  test("reports the provider selected by direct Auto routing", async () => {
    const { runtimeModel } = await getModelClient(
      { provider: "auto", name: "auto" },
      {
        enableDyadPro: false,
        providerSettings: {
          google: { apiKey: { value: "google-key" } },
        },
      } as unknown as UserSettings,
    );

    expect(runtimeModel).toMatchObject({
      provider: "google",
      name: "gemini-3.5-flash",
    });
  });

  test("builds catalog-derived call options in fallback-model order", async () => {
    vi.mocked(getLanguageModels).mockImplementation(async ({ providerId }) => {
      const catalogEntries = {
        openai: [
          {
            apiName: "gpt-5.5",
            temperature: 1,
            maxOutputTokens: 64_000,
          },
        ],
        anthropic: [
          {
            apiName: "claude-sonnet-4-20250514",
            temperature: undefined,
            maxOutputTokens: 32_000,
          },
        ],
        google: [
          {
            apiName: "gemini-3.5-flash",
            temperature: 0.7,
            maxOutputTokens: 16_000,
          },
        ],
      } as const;
      return [
        ...(catalogEntries[providerId as keyof typeof catalogEntries] ?? []),
      ] as any;
    });

    const { modelClient } = await getModelClient(
      { provider: "auto", name: "auto" },
      {
        enableDyadPro: true,
        selectedChatMode: "local-agent",
        providerSettings: {
          auto: { apiKey: { value: "dyad-pro-key" } },
        },
      } as unknown as UserSettings,
    );

    const fallbackSettings = (
      modelClient.model as unknown as {
        settings: {
          models: Array<{ modelId: string }>;
          modelCallOptions: Array<{
            temperature?: number;
            maxOutputTokens?: number;
          }>;
        };
      }
    ).settings;

    expect(fallbackSettings.models.map((model) => model.modelId)).toEqual([
      "gpt-5.5",
      "anthropic/claude-sonnet-4-20250514",
      "gemini/gemini-3.5-flash",
    ]);
    expect(fallbackSettings.modelCallOptions).toEqual([
      { temperature: 1, maxOutputTokens: 64_000 },
      { temperature: undefined, maxOutputTokens: 32_000 },
      { temperature: 0.7, maxOutputTokens: 16_000 },
    ]);
  });

  test("routes Auto Sidekick through the regular Agent Auto models", async () => {
    const { modelClient, runtimeModel } = await getModelClient(
      {
        provider: "auto",
        name: "auto-sidekick",
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
    expect(runtimeModel).toMatchObject({ provider: "auto", name: "auto" });
  });

  test("adds OpenRouter free as a regular auto fallback only outside Dyad Pro", async () => {
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

    const fallbackModels = (
      modelClient.model as unknown as {
        settings: { models: Array<{ modelId: string }> };
      }
    ).settings.models;

    expect(fallbackModels.map((model) => model.modelId)).toEqual([
      "nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter/free",
    ]);
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

  test("routes Auto (balanced) through its catalog-selected Responses API model", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    setModelClientFetchForTesting(
      vi.fn(async (url, init) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            id: "resp-balanced",
            created_at: 1_700_000_000,
            model: "openrouter/x-ai/grok-4.6",
            output: [
              {
                type: "message",
                role: "assistant",
                id: "msg-balanced",
                content: [
                  {
                    type: "output_text",
                    text: "ok",
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const { modelClient, runtimeModel } = await getModelClient(
      { provider: "auto", name: "balanced" },
      {
        enableDyadPro: true,
        selectedChatMode: "build",
        providerSettings: {
          auto: { apiKey: { value: "dyad-pro-key" } },
        },
      } as unknown as UserSettings,
    );

    await generateText({
      model: modelClient.model,
      prompt: "hi",
      maxRetries: 0,
    });

    expect(capturedUrl).toMatch(/\/v1\/responses$/);
    expect(capturedBody?.model).toBe("openrouter/x-ai/grok-4.6");
    expect((modelClient.model as { modelId: string }).modelId).toBe(
      "openrouter/x-ai/grok-4.6",
    );
    expect(modelClient.builtinProviderId).toBe("openrouter");
    expect(runtimeModel).toEqual({ provider: "auto", name: "balanced" });
  });

  test("rejects Auto (balanced) without Dyad Pro instead of falling back", async () => {
    await expect(
      getModelClient({ provider: "auto", name: "balanced" }, {
        enableDyadPro: false,
        providerSettings: {
          openrouter: { apiKey: { value: "openrouter-key" } },
        },
      } as unknown as UserSettings),
    ).rejects.toMatchObject({
      message:
        "Auto (balanced) requires Dyad Pro. Switch to another model or enable Dyad Pro.",
    });
  });

  test("routes the Value model through the Responses API in local agent mode", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    setModelClientFetchForTesting(
      vi.fn(async (url, init) => {
        capturedUrl = url.toString();
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            id: "resp-test",
            created_at: 1_700_000_000,
            model: "dyad/value",
            output: [
              {
                type: "message",
                role: "assistant",
                id: "msg-test",
                content: [
                  {
                    type: "output_text",
                    text: "ok",
                    annotations: [],
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 1,
              output_tokens: 1,
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const { modelClient } = await getModelClient(
      {
        provider: "auto",
        name: "value",
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

    await generateText({
      model: modelClient.model,
      prompt: "hi",
      maxRetries: 0,
    });

    expect(capturedUrl).toMatch(/\/v1\/responses$/);
    expect(capturedBody).toMatchObject({
      reasoning: {
        summary: "detailed",
        effort: "medium",
      },
      include: ["reasoning.encrypted_content"],
      store: false,
    });
    expect((modelClient.model as { modelId: string }).modelId).toBe(
      "dyad/value",
    );
  });

  test("sends OpenRouter app attribution headers", async () => {
    let capturedHeaders: Headers | undefined;
    setModelClientFetchForTesting(
      vi.fn(async (_url, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(
          JSON.stringify({
            id: "chatcmpl-test",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "ok",
                },
                finish_reason: "stop",
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    const { modelClient } = await getModelClient(
      {
        provider: "openrouter",
        name: "openrouter/free",
      },
      {
        providerSettings: {
          openrouter: {
            apiKey: {
              value: "openrouter-key",
            },
          },
        },
      } as unknown as UserSettings,
    );

    await generateText({
      model: modelClient.model,
      prompt: "hi",
      maxRetries: 0,
    });

    expect(capturedHeaders?.get("Authorization")).toBe("Bearer openrouter-key");
    expect(capturedHeaders?.get("HTTP-Referer")).toBe(OPENROUTER_APP_REFERER);
    expect(capturedHeaders?.get("X-OpenRouter-Title")).toBe(
      OPENROUTER_APP_TITLE,
    );
    expect(capturedHeaders?.get("X-OpenRouter-Categories")).toBe(
      OPENROUTER_APP_CATEGORIES,
    );
  });
});

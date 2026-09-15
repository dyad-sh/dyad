import { preflightSubscriptionTurn } from "../services/subscription_turn_preflight";
import type { AutoModelCandidates } from "../services/auto_model_candidates";
vi.mock("../services/codex_subscription_auth", () => ({
  getCodexSubscriptionCredentials: vi.fn(async () => ({})),
}));
vi.mock("../services/codex_subscription_credit_check", () => ({
  checkSubscriptionCredits: vi.fn(async () => {}),
}));
import { afterEach, describe, expect, test, vi } from "vitest";
import { generateText, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { getSubscriptionAccount } from "../services/codex_subscription_account";
import { createCodexSubscriptionModel } from "./codex_subscription_provider";
import { resolveBuiltinModelAlias } from "../shared/remote_language_model_catalog";

vi.mock("../services/codex_subscription_account", () => ({
  getSubscriptionAccount: vi.fn(async () => ({ connected: false, models: [] })),
}));
vi.mock("./codex_subscription_provider", () => ({
  createCodexSubscriptionModel: vi.fn(
    async (modelId: string) =>
      new MockLanguageModelV3({ modelId, provider: "chatgpt-subscription" }),
  ),
}));

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
    ...["custom", "lmstudio", "ollama"].map((id) => ({
      id,
      name: id,
      type: id === "custom" ? "custom" : "local",
      apiBaseUrl: "http://localhost:1234/v1",
    })),
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
  test("does not send a priority tier on OpenAI API-key requests with Fast mode enabled", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    setModelClientFetchForTesting(fetch);
    const { modelClient } = await getModelClient(
      { provider: "openai", name: "gpt-test" },
      {
        enableDyadPro: false,
        chatgptFastMode: true,
        providerSettings: { openai: { apiKey: { value: "test-api-key" } } },
      } as unknown as UserSettings,
      {
        provider: "openai",
        name: "gpt-test",
        connection: "api-key",
        effortLevel: "medium",
      },
    );
    const result = await (modelClient.model as LanguageModelV3).doStream({
      prompt: [],
    });
    await result.stream.cancel();
    expect(createCodexSubscriptionModel).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).not.toHaveProperty(
      "service_tier",
    );
  });

  test.each(["custom", "lmstudio", "ollama"])(
    "reports %s streaming usage only with Pro enabled",
    async (provider) => {
      for (const enableDyadPro of [true, false]) {
        const reports = vi.fn<typeof fetch>(async () =>
          Response.json({ chargedUsd: 0.1 }),
        );
        vi.stubGlobal("fetch", reports);
        let requestBody: Record<string, unknown> = {};
        let providerHeaders: unknown;
        setModelClientFetchForTesting(async (_url, init) => {
          requestBody = JSON.parse(String(init?.body));
          providerHeaders = init?.headers;
          const chunks = [
            {
              id: "test",
              model: "resolved-model",
              choices: [
                { index: 0, delta: { content: "hello" }, finish_reason: null },
              ],
            },
            {
              id: "test",
              model: "resolved-model",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
              },
            },
          ];
          return new Response(
            chunks.map((c) => "data: " + JSON.stringify(c) + "\n\n").join("") +
              "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          );
        });
        try {
          const result = await getModelClient(
            { provider, name: "test-model" },
            {
              enableDyadPro,
              providerSettings: {
                auto: { apiKey: { value: "test-pro" } },
                custom: { apiKey: { value: "test-custom" } },
              },
            } as unknown as UserSettings,
          );
          expect(
            await streamText({
              model: result.modelClient.model,
              prompt: "hello",
            }).text,
          ).toBe("hello");
          expect(JSON.stringify(providerHeaders)).not.toContain("test-pro");
          if (provider === "custom")
            expect(JSON.stringify(providerHeaders)).toContain("test-custom");
          expect(reports).toHaveBeenCalledTimes(enableDyadPro ? 1 : 0);
          expect(requestBody.stream_options).toEqual(
            enableDyadPro ? { include_usage: true } : undefined,
          );
          if (enableDyadPro)
            expect(
              JSON.parse(String(reports.mock.calls[0][1]?.body)),
            ).toMatchObject({
              connection: provider === "custom" ? "byok" : "local",
              modelProvider: provider,
              totalTokens: 150,
            });
        } finally {
          setModelClientFetchForTesting(undefined);
          vi.unstubAllGlobals();
        }
      }
    },
  );
  test.each(["custom", "lmstudio", "ollama"])(
    "keeps %s direct with Pro enabled and disabled",
    async (provider) => {
      for (const enableDyadPro of [true, false]) {
        const result = await getModelClient({ provider, name: "test-model" }, {
          enableDyadPro,
          providerSettings: {
            auto: { apiKey: { value: "test-pro" } },
            custom: { apiKey: { value: "test-custom" } },
          },
        } as unknown as UserSettings);
        expect(
          (result.modelClient.model as { provider: string }).provider,
        ).toContain(provider);
        expect(result.isEngineEnabled).not.toBe(true);
      }
    },
  );
  test("legacy API key selection cannot bypass enabled Pro credits", async () => {
    const { modelClient, isEngineEnabled } = await getModelClient(
      { provider: "openai", name: "gpt-5.4", connection: "api-key" },
      {
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "test-pro" } },
          openai: { apiKey: { value: "test-api" } },
        },
      } as unknown as UserSettings,
    );
    expect(isEngineEnabled).toBe(true);
    expect((modelClient.model as { provider: string }).provider).toContain(
      "dyad-engine",
    );
  });
  test("explicit Pro selection does not fall back to a configured API key", async () => {
    await expect(
      getModelClient(
        { provider: "openai", name: "gpt-5.4", connection: "pro" },
        {
          enableDyadPro: false,
          providerSettings: { openai: { apiKey: { value: "test-api" } } },
        } as unknown as UserSettings,
      ),
    ).rejects.toThrow("Enable Dyad Pro");
  });
  test("an explicit auxiliary model does not inherit the default subscription connection", async () => {
    const { modelClient } = await getModelClient(
      { provider: "anthropic", name: "claude-sonnet-4-20250514" },
      {
        selectedModel: {
          provider: "openai",
          name: "gpt-5.4",
          connection: "subscription",
        },
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "test-pro" } } },
      } as unknown as UserSettings,
    );
    expect((modelClient.model as { modelId: string }).modelId).toBe(
      "anthropic/claude-sonnet-4-20250514",
    );
  });

  test.each(["local-agent", "build", "ask", "plan"])(
    "routes resolved Auto GPT through subscription in %s mode",
    async (selectedChatMode) => {
      vi.mocked(getSubscriptionAccount).mockResolvedValue({
        connected: true,
        models: ["gpt-5.5"],
      } as any);
      const settings = {
        enableDyadPro: true,
        chatgptFastMode: true,
        selectedChatMode,
        providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      } as unknown as UserSettings;
      const result = await getModelClient(
        { provider: "auto", name: "auto" },
        settings,
        {
          provider: "auto",
          name: "auto",
          effortLevel: "high",
          connection: "pro",
        },
        { chatId: 42 },
      );
      const chain = (result.modelClient.model as any).settings;
      expect(chain.models.map((model: any) => model.modelId)).toEqual([
        "gpt-5.5",
        "anthropic/claude-sonnet-4-20250514",
        "gemini/gemini-3.5-flash",
      ]);
      expect(chain.models[0].provider).toBe("chatgpt-subscription");
      expect(chain.allowFallback).toEqual([false, true, true]);
      expect(result.modelClient.getRuntimeModel?.()).toMatchObject({
        provider: "openai",
        name: "gpt-5.5",
        connection: "subscription",
      });
      expect(createCodexSubscriptionModel).toHaveBeenCalledWith(
        "gpt-5.5",
        settings.providerSettings?.auto?.apiKey?.value,
        {
          chatId: 42,
        },
        true,
      );
    },
  );

  test("routes an eligible auxiliary model without inheriting the default model", async () => {
    vi.mocked(getSubscriptionAccount).mockResolvedValue({
      connected: true,
      models: ["gpt-aux"],
    } as any);
    const result = await getModelClient(
      { provider: "openai", name: "gpt-aux" },
      {
        selectedModel: { provider: "anthropic", name: "claude" },
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      } as unknown as UserSettings,
    );
    expect((result.modelClient.model as any).provider).toBe(
      "chatgpt-subscription",
    );
    expect(result.runtimeModel).toMatchObject({
      name: "gpt-aux",
      connection: "subscription",
    });
  });

  test("routes Auto Balanced after resolving its catalog alias", async () => {
    vi.mocked(getSubscriptionAccount).mockResolvedValue({
      connected: true,
      models: ["gpt-balanced"],
    } as any);
    vi.mocked(resolveBuiltinModelAlias).mockResolvedValueOnce({
      providerId: "openai",
      apiName: "gpt-balanced",
      apiProtocol: "responses",
    } as any);
    const result = await getModelClient(
      { provider: "auto", name: "balanced" },
      {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      } as unknown as UserSettings,
    );
    expect((result.modelClient.model as any).provider).toBe(
      "chatgpt-subscription",
    );
    expect(result.modelClient.getRuntimeModel?.()).toMatchObject({
      name: "gpt-balanced",
      connection: "subscription",
    });
  });

  test.each(["auto", "auto-sidekick", "balanced"])(
    "reuses preflight candidates for %s without resolving aliases or billing again",
    async (name) => {
      const auto = { provider: "auto", name, effortLevel: "medium" };
      const settings = {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      } as unknown as UserSettings;
      vi.mocked(getSubscriptionAccount).mockResolvedValue({
        connected: true,
        models: ["gpt-5.5"],
      } as any);
      if (name === "balanced") {
        vi.mocked(resolveBuiltinModelAlias).mockResolvedValueOnce({
          providerId: "openai",
          apiName: "gpt-5.5",
          apiProtocol: "responses",
        } as any);
      }
      const autoModelCandidates: AutoModelCandidates = new Map();
      const { model: selection } = await preflightSubscriptionTurn(
        auto,
        settings,
        new AbortController().signal,
        autoModelCandidates,
      );
      const aliasCalls = vi.mocked(resolveBuiltinModelAlias).mock.calls.length;
      const accountCalls = vi.mocked(getSubscriptionAccount).mock.calls.length;
      vi.mocked(getSubscriptionAccount).mockResolvedValue({
        connected: false,
        models: [],
      } as any);
      const result = await getModelClient(auto, settings, selection, {
        chatId: 1,
        autoModelCandidates,
      });
      expect(result.modelClient.getRuntimeModel?.()).toMatchObject({
        name: "gpt-5.5",
        connection: "subscription",
      });
      expect(resolveBuiltinModelAlias).toHaveBeenCalledTimes(aliasCalls);
      expect(getSubscriptionAccount).toHaveBeenCalledTimes(accountCalls);
    },
  );

  test("honors explicit Pro credits even for eligible resolved Auto models", async () => {
    vi.mocked(getSubscriptionAccount).mockResolvedValue({
      connected: true,
      models: ["gpt-5.5"],
    } as any);
    const result = await getModelClient({ provider: "auto", name: "auto" }, {
      enableDyadPro: true,
      proModelUsage: "pro",
      chatgptFastMode: true,
      selectedChatMode: "local-agent",
      providerSettings: { auto: { apiKey: { value: "pro-key" } } },
    } as unknown as UserSettings);
    expect(
      (result.modelClient.model as any).settings.models[0].provider,
    ).toContain("dyad-engine");
    expect(createCodexSubscriptionModel).not.toHaveBeenCalled();
  });
  test("does not inherit legacy source fields when resolving an auxiliary model", async () => {
    vi.mocked(getSubscriptionAccount).mockResolvedValue({
      connected: true,
      models: ["gpt-aux"],
    } as any);
    const result = await getModelClient(
      { provider: "openai", name: "gpt-aux", connection: "api-key" },
      {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      } as unknown as UserSettings,
    );
    expect((result.modelClient.model as any).provider).toBe(
      "chatgpt-subscription",
    );
  });
  test("constructs the concrete subscription model for free Auto without an API key", async () => {
    vi.mocked(getSubscriptionAccount).mockResolvedValue({
      connected: true,
      models: ["gpt-5.6-luna"],
    } as any);
    const result = await getModelClient({ provider: "auto", name: "auto" }, {
      enableDyadPro: false,
      chatgptFastMode: true,
      providerSettings: {},
      selectedModel: { provider: "auto", name: "auto" },
    } as UserSettings);
    expect(result.runtimeModel).toMatchObject({
      provider: "openai",
      name: "gpt-5.6-luna",
      connection: "subscription",
    });
    expect(createCodexSubscriptionModel).toHaveBeenCalledWith(
      "gpt-5.6-luna",
      null,
      undefined,
      true,
    );
  });
  test("keeps the accepted turn source pinned", async () => {
    vi.mocked(getSubscriptionAccount).mockResolvedValue({
      connected: true,
      models: ["gpt-aux"],
    } as any);
    const result = await getModelClient(
      { provider: "openai", name: "gpt-aux" },
      {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "pro-key" } } },
      } as unknown as UserSettings,
      {
        provider: "openai",
        name: "gpt-aux",
        effortLevel: "high",
        connection: "pro",
      },
    );
    expect((result.modelClient.model as any).provider).toContain("dyad-engine");
    expect(createCodexSubscriptionModel).not.toHaveBeenCalled();
  });
  afterEach(() => {
    vi.mocked(getSubscriptionAccount).mockResolvedValue({
      connected: false,
      models: [],
    } as any);
    vi.mocked(createCodexSubscriptionModel).mockClear();
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

  test.each(
    (["local-agent", "ask", "plan", "build", undefined] as const).flatMap(
      (mode) => [
        ...["gpt-6-astra", "gpt-5.5"].map((name) => ({
          provider: "openai",
          name,
          mode,
          modelId: name,
        })),
        { provider: "auto", name: "value", mode, modelId: "dyad/value" },
      ],
    ),
  )(
    "routes $provider/$name through Responses in $mode mode",
    async ({ provider, name, mode, modelId }) => {
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
              model: modelId,
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
          provider,
          name,
        },
        {
          enableDyadPro: true,
          selectedChatMode: mode,
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
        maxOutputTokens: 128000,
        maxRetries: 0,
      });

      expect(capturedUrl).toMatch(/\/v1\/responses$/);
      expect(capturedBody).not.toHaveProperty("max_tokens");
      expect(capturedBody).not.toHaveProperty("reasoning_effort");
      expect(capturedBody).toMatchObject({
        model: modelId,
        max_output_tokens: 128000,
        reasoning: {
          summary: "detailed",
          effort: "medium",
        },
        include: ["reasoning.encrypted_content"],
        store: false,
      });
      expect((modelClient.model as { modelId: string }).modelId).toBe(modelId);
    },
  );

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

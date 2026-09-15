import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { UserSettings } from "@/lib/schemas";
import { DyadErrorKind } from "@/errors/dyad_error";

vi.mock("../services/codex_subscription_auth", () => ({
  getCodexSubscriptionStatus: () => ({ connected: true, pending: false }),
  getCodexSubscriptionCredentials: async () => ({
    access: "test-access",
    accountId: "test-account",
  }),
}));
vi.mock("../services/codex_subscription_usage", () => ({
  startSubscriptionUsage: async () => "test-usage",
  interruptSubscriptionUsage: vi.fn(),
  finishSubscriptionUsage: vi.fn(),
}));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    }),
  },
}));
vi.mock("../shared/remote_language_model_catalog", () => ({
  getBuiltinLanguageModelCatalog: async () => ({
    modelsByProvider: { openai: [{ apiName: "gpt-fallback" }] },
  }),
  resolveBuiltinModelAlias: async (alias: string) =>
    alias === "dyad/auto/openai"
      ? { providerId: "openai", apiName: "gpt-fallback" }
      : alias === "dyad/auto/anthropic"
        ? { providerId: "anthropic", apiName: "claude-paid" }
        : null,
}));
vi.mock("../shared/language_model_helpers", () => ({
  getLanguageModels: async () => [],
  getLanguageModelProviders: async () => [
    { id: "auto", name: "Dyad", gatewayPrefix: "dyad/", type: "cloud" },
    { id: "openai", name: "OpenAI", gatewayPrefix: "", type: "cloud" },
    {
      id: "anthropic",
      name: "Anthropic",
      gatewayPrefix: "anthropic/",
      type: "cloud",
    },
  ],
}));
import {
  getModelClient,
  setModelClientFetchForTesting,
} from "./get_model_client";
import {
  getSubscriptionAccount,
  resetSubscriptionAccount,
} from "../services/codex_subscription_account";
import { usesChatGPTSubscription } from "@/lib/subscriptionModels";

const settings = {
  enableDyadPro: true,
  proModelUsage: "subscription",
  selectedChatMode: "ask",
  providerSettings: { auto: { apiKey: { value: "pro-test-key" } } },
} as unknown as UserSettings;

beforeEach(() => resetSubscriptionAccount());
afterEach(() => {
  vi.unstubAllGlobals();
  setModelClientFetchForTesting(undefined);
});

it.each([
  ["empty", "direct", "stream"],
  ["error", "direct", "generate"],
  ["empty", "auto", "stream"],
  ["error", "auto", "stream"],
] as const)(
  "surfaces rejection of a %s-catalog fallback in %s/%s without Pro inference",
  async (catalogFailure, selection, method) => {
    const paidFetch = vi.fn(async () => {
      throw new Error("Unexpected Pro request");
    });
    setModelClientFetchForTesting(paidFetch);
    const subscriptionFetch = vi.fn(async (url: string) => {
      if (url.includes("/models?")) {
        if (catalogFailure === "error") throw new Error("catalog offline");
        return Response.json({ models: [] });
      }
      expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
      return Response.json(
        {
          error: {
            message: "Model is not available for this ChatGPT account",
            code: "model_not_found",
          },
        },
        { status: 404 },
      );
    });
    vi.stubGlobal("fetch", subscriptionFetch);
    const account = await getSubscriptionAccount({ includeUsage: false });
    expect(
      usesChatGPTSubscription(
        { provider: "openai", name: "gpt-fallback" },
        settings,
        account,
      ),
    ).toBe(true);
    const { modelClient } = await getModelClient(
      selection === "auto"
        ? { provider: "auto", name: "auto" }
        : { provider: "openai", name: "gpt-fallback" },
      settings,
    );
    if (selection === "auto") {
      // Pro is a real available candidate; a passing test must prove it is not attempted.
      expect(
        (
          modelClient.model as unknown as {
            settings: { allowFallback: boolean[] };
          }
        ).settings.allowFallback,
      ).toEqual([false, true]);
    }
    const model = modelClient.model as LanguageModelV3;
    await expect(
      method === "stream"
        ? model.doStream({ prompt: [] })
        : model.doGenerate({ prompt: [] }),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
      message: expect.stringContaining("Model is not available"),
    });
    expect(
      subscriptionFetch.mock.calls.filter(([url]) =>
        url.includes("/responses"),
      ),
    ).toHaveLength(1);
    expect(paidFetch).not.toHaveBeenCalled();
    expect(
      (await getSubscriptionAccount({ includeUsage: false })).models,
    ).toEqual(["gpt-fallback"]);
  },
);

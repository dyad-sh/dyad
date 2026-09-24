vi.mock("../shared/language_model_helpers", () => ({
  getLanguageModelProviders: async () => [{ id: "custom", type: "custom" }],
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSelection, UserSettings } from "@/lib/schemas";
import { DyadErrorKind } from "@/errors/dyad_error";
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  credentials: vi.fn(),
  credits: vi.fn(),
  alias: vi.fn(),
}));
vi.mock("./codex_subscription_account", () => ({
  getSubscriptionAccount: mocks.account,
}));
vi.mock("./codex_subscription_auth", () => ({
  getCodexSubscriptionCredentials: mocks.credentials,
}));
vi.mock("./codex_subscription_credit_check", () => ({
  checkSubscriptionCredits: mocks.credits,
}));
vi.mock("../shared/remote_language_model_catalog", () => ({
  resolveBuiltinModelAlias: mocks.alias,
}));
vi.mock("../utils/model_effort", () => ({
  resolveModelSelection: async ({ model }: { model: ModelSelection }) => model,
}));
import type { AutoModelCandidates } from "./auto_model_candidates";
import { preflightSubscriptionTurn as preflightWithAdmission } from "./subscription_turn_preflight";
// These tests focus on model routing; admission consumption has its own tests.
async function preflightSubscriptionTurn(
  ...args: Parameters<typeof preflightWithAdmission>
) {
  return (await preflightWithAdmission(...args)).model;
}
const model = {
  provider: "openai",
  name: "eligible-model",
  effortLevel: "medium",
  connection: "api-key",
} as ModelSelection;
const settings = {
  enableDyadPro: true,
  providerSettings: { auto: { apiKey: { value: "test-key" } } },
} as unknown as UserSettings;
const signal = new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.account.mockResolvedValue({
    connected: true,
    models: ["eligible-model"],
  });
});

it.each(["build", "ask", "plan", "local-agent"] as const)(
  "matches Codex billing eligibility in %s mode, with Pro on or off",
  async (selectedChatMode) => {
    for (const provider of ["openai", "claude-code"]) {
      for (const enableDyadPro of [true, false]) {
        mocks.credits.mockClear();
        const result = await preflightWithAdmission(
          { ...model, provider },
          {
            ...settings,
            selectedChatMode,
            enableDyadPro,
            enableClaudeCodeSubscription: true,
          },
          signal,
        );
        const billed = enableDyadPro && selectedChatMode === "local-agent";
        expect(mocks.credits).toHaveBeenCalledTimes(billed ? 1 : 0);
        expect(Boolean(result.externalModelAdmission)).toBe(billed);
      }
    }
  },
);

it("blocks disabled Claude experiments before authentication or billing", async () => {
  await expect(
    preflightWithAdmission(
      { ...model, provider: "claude-code" },
      settings,
      signal,
    ),
  ).rejects.toThrow("Settings → Experiments");
  expect(mocks.credentials).not.toHaveBeenCalled();
  expect(mocks.credits).not.toHaveBeenCalled();
});
describe("global subscription turn routing", () => {
  it.each(["build", "ask", "plan"] as const)(
    "allows %s subscription turns with no Dyad credits",
    async (selectedChatMode) => {
      mocks.credits.mockRejectedValue(new Error("Out of credits"));
      const result = await preflightWithAdmission(
        model,
        { ...settings, selectedChatMode },
        signal,
      );
      expect(result.model.connection).toBe("subscription");
      expect(result.externalModelAdmission).toBeUndefined();
      expect(mocks.account).toHaveBeenCalled();
      expect(mocks.credentials).toHaveBeenCalled();
      expect(mocks.credits).not.toHaveBeenCalled();
    },
  );
  it("defaults connected eligible models to subscription, ignoring legacy chat source", async () => {
    expect(
      await preflightSubscriptionTurn(model, settings, signal),
    ).toMatchObject({ connection: "subscription" });
    expect(mocks.credits).toHaveBeenCalledWith("test-key", signal);
  });
  it.each(["ollama", "lmstudio", "custom"])(
    "checks credits and keeps %s direct",
    async (provider) => {
      expect(
        await preflightSubscriptionTurn(
          { ...model, provider },
          settings,
          signal,
        ),
      ).toMatchObject({ connection: "api-key" });
      expect(mocks.credits).toHaveBeenCalledWith("test-key", signal);
      expect(mocks.account).not.toHaveBeenCalled();
      mocks.credits.mockRejectedValue(new Error("Out of credits"));
      await expect(
        preflightSubscriptionTurn({ ...model, provider }, settings, signal),
      ).rejects.toThrow("Out of credits");
    },
  );
  it("uses Pro for non-ChatGPT and ineligible models", async () => {
    for (const m of [
      { ...model, provider: "anthropic" },
      { ...model, name: "gpt-4o" },
    ])
      expect(
        await preflightSubscriptionTurn(m, settings, signal),
      ).toMatchObject({ connection: "pro" });
    expect(mocks.credits).not.toHaveBeenCalled();
  });
  it("respects the global Pro preference in existing subscription chats", async () => {
    expect(
      await preflightSubscriptionTurn(
        { ...model, connection: "subscription" },
        { ...settings, proModelUsage: "pro" },
        signal,
      ),
    ).toMatchObject({ connection: "pro" });
    expect(mocks.account).not.toHaveBeenCalled();
  });
  it.each([
    "Sign-in was not completed. Try connecting again.",
    "Sign-in timed out. Try again.",
  ])("uses Pro after abandoned sign-in: %s", async (error) => {
    mocks.account.mockResolvedValue({ connected: false, models: [], error });
    expect(
      await preflightSubscriptionTurn(model, settings, signal),
    ).toMatchObject({
      connection: "pro",
    });
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.credits).not.toHaveBeenCalled();
  });
  it("uses Pro when no subscription was saved", async () => {
    mocks.account.mockResolvedValue({ connected: false, models: [] });
    await expect(
      preflightSubscriptionTurn(model, settings, signal),
    ).resolves.toMatchObject({ connection: "pro" });
  });
  it.each([undefined, "subscription"] as const)(
    "rejects unreadable credentials instead of changing billing (preference=%s)",
    async (proModelUsage) => {
      mocks.account.mockResolvedValue({
        connected: false,
        credentialError: true,
        models: [],
      });
      await expect(
        preflightSubscriptionTurn(
          model,
          { ...settings, proModelUsage },
          signal,
        ),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.Auth,
        message: expect.stringContaining(
          "Reconnect your ChatGPT subscription or select Pro credits",
        ),
      });
      expect(mocks.credentials).not.toHaveBeenCalled();
      expect(mocks.credits).not.toHaveBeenCalled();
    },
  );
  it("allows explicit Pro selection despite unreadable subscription credentials", async () => {
    mocks.account.mockResolvedValue({
      connected: false,
      credentialError: true,
      models: [],
    });
    await expect(
      preflightSubscriptionTurn(
        model,
        { ...settings, proModelUsage: "pro" },
        signal,
      ),
    ).resolves.toMatchObject({ connection: "pro" });
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it("ignores subscription errors for a known ineligible model", async () => {
    mocks.account.mockResolvedValue({
      connected: true,
      models: ["eligible-model"],
      error: "Reconnect your ChatGPT subscription to continue.",
      modelsError:
        "Subscription model availability is temporarily unavailable.",
    });
    expect(
      await preflightSubscriptionTurn(
        { ...model, name: "gpt-4o" },
        settings,
        signal,
      ),
    ).toMatchObject({ connection: "pro" });
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.credits).not.toHaveBeenCalled();
  });
  it("still reports authentication errors for an eligible subscription model", async () => {
    mocks.account.mockResolvedValue({
      connected: true,
      models: ["eligible-model"],
      error: "Reconnect your ChatGPT subscription to continue.",
    });
    await expect(
      preflightSubscriptionTurn(model, settings, signal),
    ).rejects.toThrow("Reconnect your ChatGPT subscription");
    expect(mocks.credits).not.toHaveBeenCalled();
  });
  it("does not guess Pro routing when a connected account has no catalog", async () => {
    mocks.account.mockResolvedValue({
      connected: true,
      models: [],
      modelsError:
        "Subscription model availability is temporarily unavailable.",
    });
    await expect(
      preflightSubscriptionTurn(model, settings, signal),
    ).rejects.toThrow("Subscription model availability is unavailable");
    expect(mocks.credits).not.toHaveBeenCalled();
  });
  it("explains both recovery options for free users with unreadable credentials", async () => {
    mocks.account.mockResolvedValue({
      connected: false,
      credentialError: true,
      models: [],
    });
    await expect(
      preflightSubscriptionTurn(
        model,
        { ...settings, enableDyadPro: false },
        signal,
      ),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Auth,
      message: expect.stringContaining(
        "Reconnect ChatGPT, or disconnect it in the model picker to use your OpenAI API key",
      ),
    });
    expect(mocks.credits).not.toHaveBeenCalled();
  });
  it.each([
    ["free", "gpt-5.6-luna"],
    [undefined, "gpt-5.6-luna"],
    ["plus", "eligible-model"],
    ["pro", "eligible-model"],
  ] as const)(
    "resolves free-user Auto using ChatGPT tier %s",
    async (planType, expected) => {
      mocks.account.mockResolvedValue({
        connected: true,
        planType,
        models: ["first-model", "eligible-model", "gpt-5.6-luna"],
      });
      const result = await preflightSubscriptionTurn(
        { provider: "auto", name: "auto", effortLevel: "medium" },
        { ...settings, enableDyadPro: false, selectedModel: model },
        signal,
      );
      expect(result).toMatchObject({
        provider: "openai",
        name: expected,
        connection: "subscription",
      });
      expect(mocks.account).toHaveBeenCalled();
      expect(mocks.credentials).toHaveBeenCalled();
      expect(mocks.credits).not.toHaveBeenCalled();
    },
  );
  it("falls back to the first subscription model for Auto when Luna is unavailable", async () => {
    const result = await preflightSubscriptionTurn(
      { provider: "auto", name: "auto", effortLevel: "medium" },
      { ...settings, enableDyadPro: false },
      signal,
    );
    expect(result).toMatchObject({
      provider: "openai",
      name: "eligible-model",
      connection: "subscription",
    });
    expect(mocks.account).toHaveBeenCalled();
  });
  it("keeps disconnected Auto on its existing provider-key path", async () => {
    mocks.account.mockResolvedValue({ connected: false, models: [] });
    expect(
      await preflightSubscriptionTurn(
        { provider: "auto", name: "auto", effortLevel: "medium" },
        { ...settings, enableDyadPro: false },
        signal,
      ),
    ).toEqual({ provider: "auto", name: "auto", effortLevel: "medium" });
    expect(mocks.account).toHaveBeenCalled();
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it("preserves own-key routing when Pro is off", async () => {
    mocks.account.mockResolvedValue({ connected: false, models: [] });
    expect(
      await preflightSubscriptionTurn(
        model,
        { ...settings, enableDyadPro: false },
        signal,
      ),
    ).not.toHaveProperty("connection");
    expect(mocks.account).toHaveBeenCalled();
    expect(mocks.credits).not.toHaveBeenCalled();
  });
  it.each([{}, settings.providerSettings])(
    "allows free subscription turns without Dyad credit checks (%j)",
    async (providerSettings) => {
      const freeSettings = {
        ...settings,
        enableDyadPro: false,
        providerSettings,
      };
      const result = await preflightWithAdmission(model, freeSettings, signal);
      expect(result.model.connection).toBe("subscription");
      expect(result.externalModelAdmission).toBeUndefined();
      expect(mocks.account).toHaveBeenCalled();
      expect(mocks.credentials).toHaveBeenCalled();
      expect(mocks.credits).not.toHaveBeenCalled();
    },
  );
  it("keeps unsupported free models on their own provider credentials", async () => {
    const result = await preflightSubscriptionTurn(
      { ...model, name: "unsupported" },
      { ...settings, providerSettings: {} },
      signal,
    );
    expect(result).not.toHaveProperty("connection");
    expect(mocks.credits).not.toHaveBeenCalled();
  });
  it("propagates confirmed credit and auth denial before accepting a turn", async () => {
    mocks.credits.mockRejectedValue(new Error("Out of credits"));
    await expect(
      preflightSubscriptionTurn(model, settings, signal),
    ).rejects.toThrow("Out of credits");
    mocks.credentials.mockRejectedValue(new Error("Reconnect"));
    await expect(
      preflightSubscriptionTurn(model, settings, signal),
    ).rejects.toThrow("Reconnect");
  });
  it("does not silently switch when the account reports a usage limit", async () => {
    mocks.account.mockResolvedValue({
      connected: true,
      models: ["eligible-model"],
      limitReached: true,
    });
    expect(
      await preflightSubscriptionTurn(model, settings, signal),
    ).toMatchObject({ connection: "subscription" });
  });
});

describe("Auto subscription admission", () => {
  beforeEach(() => {
    mocks.alias.mockImplementation(async (alias: string) => ({
      providerId: alias.endsWith("anthropic") ? "anthropic" : "openai",
      apiName: "eligible-model",
      apiProtocol: "responses",
    }));
  });

  it.each(["auto", "auto-sidekick", "balanced"])(
    "preflights %s and retains each candidate's billing source",
    async (name) => {
      const candidates: AutoModelCandidates = new Map();
      const result = await preflightSubscriptionTurn(
        { provider: "auto", name, effortLevel: "medium" },
        settings,
        signal,
        candidates,
      );
      expect(result).toMatchObject({
        provider: "auto",
        name,
        effortLevel: "medium",
      });
      expect(mocks.credentials).toHaveBeenCalledOnce();
      expect(mocks.credits).toHaveBeenCalledExactlyOnceWith("test-key", signal);
      expect(
        [...candidates.values()].map(
          (candidate) => candidate?.selection.connection,
        ),
      ).toEqual(
        name === "balanced"
          ? ["subscription"]
          : ["subscription", "pro", "subscription"],
      );
    },
  );

  it.each(["auto", "auto-sidekick", "balanced"])(
    "rejects %s on credential or credit failure",
    async (name) => {
      const auto = { provider: "auto", name, effortLevel: "medium" };
      mocks.credentials.mockRejectedValueOnce(new Error("Reconnect"));
      await expect(
        preflightSubscriptionTurn(auto, settings, signal),
      ).rejects.toThrow("Reconnect");
      mocks.credits.mockRejectedValueOnce(new Error("Out of credits"));
      await expect(
        preflightSubscriptionTurn(auto, settings, signal),
      ).rejects.toThrow("Out of credits");
    },
  );

  it("allows explicit Pro billing with broken subscription credentials", async () => {
    mocks.credentials.mockRejectedValue(new Error("Reconnect"));
    await preflightSubscriptionTurn(
      { provider: "auto", name: "auto", effortLevel: "medium" },
      { ...settings, proModelUsage: "pro" },
      signal,
    );
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.credits).not.toHaveBeenCalled();
  });

  it("does not require a subscription for ineligible candidates", async () => {
    mocks.account.mockResolvedValue({
      connected: true,
      models: ["different-model"],
    });
    await preflightSubscriptionTurn(
      { provider: "auto", name: "auto", effortLevel: "medium" },
      settings,
      signal,
    );
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.credits).not.toHaveBeenCalled();
  });

  it("snapshots unavailable candidates and excludes free aliases", async () => {
    mocks.alias
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        providerId: "openai",
        apiName: "eligible-model:free",
      })
      .mockResolvedValueOnce(null);
    const candidates: AutoModelCandidates = new Map();
    await preflightSubscriptionTurn(
      { provider: "auto", name: "auto", effortLevel: "medium" },
      settings,
      signal,
      candidates,
    );
    expect([...candidates.values()]).toEqual([null, null, null]);
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
});

describe("cancelled admission", () => {
  it("rejects cancellation during account resolution even when the model is ineligible", async () => {
    const controller = new AbortController();
    mocks.account.mockImplementation(async () => {
      controller.abort();
      return { connected: true, models: [] };
    });
    await expect(
      preflightSubscriptionTurn(model, settings, controller.signal),
    ).rejects.toThrow();
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.credits).not.toHaveBeenCalled();
  });
});

it.each([true, false])(
  "keeps Claude on its CLI backend with Pro=%s, without ChatGPT auth",
  async (pro) => {
    const result = await preflightWithAdmission(
      { provider: "claude-code", name: "sonnet", effortLevel: "medium" },
      { ...settings, enableDyadPro: pro, enableClaudeCodeSubscription: true },
      signal,
    );
    expect(result.model).toMatchObject({
      provider: "claude-code",
      connection: "subscription",
    });
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.credits).toHaveBeenCalledTimes(pro ? 1 : 0);
    expect(Boolean(result.externalModelAdmission)).toBe(pro);
  },
);

it.each([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "azure",
  "vertex",
  "bedrock",
  "xai",
  "minimax",
  "ollama",
  "lmstudio",
  "custom",
  "auto",
])(
  "keeps BYO %s direct even with a connected subscription",
  async (provider) => {
    const result = await preflightWithAdmission(
      { ...model, provider, connection: "pro" },
      { ...settings, proModelUsage: "api-key" },
      signal,
    );
    expect(result.model).toMatchObject({ provider, connection: "api-key" });
    expect(result.externalModelAdmission).toBeDefined();
    expect(mocks.credits).toHaveBeenCalledWith("test-key", signal);
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.credentials).not.toHaveBeenCalled();
  },
);
it("does not check Dyad credits for BYO with Pro off", async () => {
  const result = await preflightWithAdmission(
    model,
    { ...settings, proModelUsage: "api-key", enableDyadPro: false },
    signal,
  );
  expect(result.model.connection).toBe("api-key");
  expect(result.externalModelAdmission).toBeUndefined();
  expect(mocks.credits).not.toHaveBeenCalled();
});
it("rejects exhausted BYO credits without falling back to a subscription", async () => {
  const { SubscriptionBillingError } =
    await import("@/shared/subscription_billing_error");
  const error = new SubscriptionBillingError("OUT_OF_CREDITS");
  mocks.credits.mockRejectedValue(error);
  await expect(
    preflightWithAdmission(
      model,
      { ...settings, proModelUsage: "api-key" },
      signal,
    ),
  ).rejects.toBe(error);
  expect(mocks.credentials).not.toHaveBeenCalled();
});
it("asks existing Claude Code chats to change model or source instead of ignoring BYO", async () => {
  await expect(
    preflightWithAdmission(
      { ...model, provider: "claude-code" },
      {
        ...settings,
        proModelUsage: "api-key",
        enableClaudeCodeSubscription: true,
      },
      signal,
    ),
  ).rejects.toThrow("Select Subscriptions");
});

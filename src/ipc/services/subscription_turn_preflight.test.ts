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
import { preflightSubscriptionTurn } from "./subscription_turn_preflight";
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
describe("global subscription turn routing", () => {
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
  it("preserves own-key routing when Pro is off", async () => {
    expect(
      await preflightSubscriptionTurn(
        model,
        { ...settings, enableDyadPro: false },
        signal,
      ),
    ).not.toHaveProperty("connection");
    expect(mocks.account).not.toHaveBeenCalled();
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

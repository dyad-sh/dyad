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

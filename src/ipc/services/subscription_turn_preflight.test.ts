import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSelection, UserSettings } from "@/lib/schemas";
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

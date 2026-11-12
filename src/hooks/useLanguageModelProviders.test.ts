import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLanguageModelProviders } from "./useLanguageModelProviders";

const mocks = vi.hoisted(() => ({
  selectedModel: {
    provider: "ollama",
    name: "llama3",
  },
  useQueryResult: {
    data: undefined,
    isLoading: true,
  },
  queryOptions: null as { networkMode?: string } | null,
  subscriptionLoading: false,
  subscription: {
    connected: false,
    pending: false,
    setupError: undefined as string | undefined,
    models: ["subscription-model"],
  },
}));
vi.mock("./useSubscriptionAccount", () => ({
  useSubscriptionAccount: () => ({
    data: mocks.subscriptionLoading ? undefined : mocks.subscription,
    isLoading: mocks.subscriptionLoading,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { networkMode?: string }) => {
    mocks.queryOptions = options;
    return mocks.useQueryResult;
  },
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    languageModel: {
      getProviders: vi.fn(),
    },
  },
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    envVars: {},
    settings: {
      providerSettings: {},
      selectedModel: mocks.selectedModel,
    },
  }),
}));

describe("useLanguageModelProviders", () => {
  beforeEach(() => {
    mocks.subscriptionLoading = false;
    mocks.subscription = {
      connected: false,
      pending: false,
      setupError: undefined as string | undefined,
      models: ["subscription-model"],
    };
    mocks.selectedModel = {
      provider: "ollama",
      name: "llama3",
    };
    mocks.useQueryResult = {
      data: undefined,
      isLoading: true,
    };
  });

  it("waits for an existing subscription before deciding provider readiness", () => {
    mocks.selectedModel = { provider: "openai", name: "subscription-model" };
    mocks.useQueryResult.isLoading = false;
    mocks.subscriptionLoading = true;
    mocks.subscription.connected = true;
    const { result, rerender } = renderHook(() => useLanguageModelProviders());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAnyProviderSetup()).toBe(false);
    mocks.subscriptionLoading = false;
    rerender();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAnyProviderSetup()).toBe(true);
  });
  it("treats a selected Ollama model as a configured provider while provider data is loading", () => {
    const { result } = renderHook(() => useLanguageModelProviders());

    expect(result.current.isAnyProviderSetup()).toBe(true);
  });

  it("loads provider metadata while the renderer is offline", () => {
    renderHook(() => useLanguageModelProviders());

    expect(mocks.queryOptions?.networkMode).toBe("always");
  });

  it("treats a selected LM Studio model as a configured provider", () => {
    mocks.selectedModel = {
      provider: "lmstudio",
      name: "local-model",
    };

    const { result } = renderHook(() => useLanguageModelProviders());

    expect(result.current.isAnyProviderSetup()).toBe(true);
  });
  it("waits for sign-in and a supported model before resuming onboarding", () => {
    mocks.selectedModel = { provider: "auto", name: "auto" };
    mocks.subscription.connected = true;
    const { result, rerender } = renderHook(() => useLanguageModelProviders());
    expect(result.current.isAnyProviderSetup()).toBe(true);
    mocks.selectedModel = { provider: "openai", name: "subscription-model" };
    mocks.subscription.pending = true;
    rerender();
    expect(result.current.isAnyProviderSetup()).toBe(false);
    mocks.subscription.pending = false;
    rerender();
    expect(result.current.isAnyProviderSetup()).toBe(true);
    expect(result.current.isProviderSetup("openai")).toBe(false);
    mocks.subscription.connected = false;
    rerender();
    expect(result.current.isAnyProviderSetup()).toBe(false);
  });
});

it.each([
  { provider: "auto", name: "auto" },
  { provider: "openai", name: "subscription-model" },
])("does not resume after incomplete subscription setup (%j)", (model) => {
  mocks.selectedModel = model;
  mocks.subscription.connected = true;
  mocks.subscription.setupError = "Catalog unavailable";
  mocks.useQueryResult.isLoading = false;
  const { result } = renderHook(() => useLanguageModelProviders());
  expect(result.current.isAnyProviderSetup()).toBe(false);
});

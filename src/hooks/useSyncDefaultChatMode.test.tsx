import { renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { StrictMode, type PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasManuallySelectedChatModeAtom } from "@/atoms/chatAtoms";
import type { UserSettings } from "@/lib/schemas";
import { useSyncDefaultChatMode } from "./useSyncDefaultChatMode";

const mocks = vi.hoisted(() => ({
  isAnyProviderSetup: true,
  providersLoading: false,
  quotaStatus: {
    isQuotaExceeded: false,
  } as { isQuotaExceeded: boolean } | undefined,
  settings: {} as UserSettings,
  updateSettings: vi.fn(),
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    envVars: {},
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("./useFreeAgentQuota", () => ({
  useFreeAgentQuota: () => ({ quotaStatus: mocks.quotaStatus }),
}));

vi.mock("./useLanguageModelProviders", () => ({
  useLanguageModelProviders: () => ({
    isAnyProviderSetup: () => mocks.isAnyProviderSetup,
    isLoading: mocks.providersLoading,
  }),
}));

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { provider: "openrouter", name: "test-model" },
    providerSettings: {
      openrouter: { apiKey: { value: "test-key" } },
    },
    selectedChatMode: "build",
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    ...overrides,
  } as UserSettings;
}

function makeWrapper(
  manuallySelected = false,
  { strict = false }: { strict?: boolean } = {},
) {
  const store = createStore();
  store.set(hasManuallySelectedChatModeAtom, manuallySelected);
  return function Wrapper({ children }: PropsWithChildren) {
    const content = <Provider store={store}>{children}</Provider>;
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
}

describe("useSyncDefaultChatMode", () => {
  beforeEach(() => {
    mocks.isAnyProviderSetup = true;
    mocks.providersLoading = false;
    mocks.quotaStatus = { isQuotaExceeded: false };
    mocks.settings = makeSettings();
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(undefined);
  });

  it("upgrades an implicit Build selection when Agent is available", async () => {
    renderHook(() => useSyncDefaultChatMode(), { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        selectedChatMode: "local-agent",
      }),
    );
  });

  it("does not duplicate an in-flight update during Strict Mode rerenders", async () => {
    let resolveUpdate: (() => void) | undefined;
    mocks.updateSettings.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    const { rerender } = renderHook(() => useSyncDefaultChatMode(), {
      wrapper: makeWrapper(false, { strict: true }),
    });

    await waitFor(() => expect(mocks.updateSettings).toHaveBeenCalledTimes(1));
    rerender();
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);

    resolveUpdate?.();
  });

  it("handles a failed settings update", async () => {
    const error = new Error("write failed");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.updateSettings.mockRejectedValue(error);

    renderHook(() => useSyncDefaultChatMode(), { wrapper: makeWrapper() });

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to sync the default chat mode",
        error,
      ),
    );
    warnSpy.mockRestore();
  });

  it("does not persist Agent while quota is unresolved", () => {
    mocks.quotaStatus = undefined;

    renderHook(() => useSyncDefaultChatMode(), { wrapper: makeWrapper() });

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("does not persist Agent before provider setup", () => {
    mocks.isAnyProviderSetup = false;

    renderHook(() => useSyncDefaultChatMode(), { wrapper: makeWrapper() });

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("preserves an explicit Build default", () => {
    mocks.settings = makeSettings({ defaultChatMode: "build" });

    renderHook(() => useSyncDefaultChatMode(), { wrapper: makeWrapper() });

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("preserves a manual session selection", () => {
    renderHook(() => useSyncDefaultChatMode(), {
      wrapper: makeWrapper(true),
    });

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});

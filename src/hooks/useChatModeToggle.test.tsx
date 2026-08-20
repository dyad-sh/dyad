import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import { createStore, Provider, useAtomValue } from "jotai";

import { hasManuallySelectedChatModeAtom } from "@/atoms/chatAtoms";
import { useChatModeToggle } from "./useChatModeToggle";

const mocks = vi.hoisted(() => ({
  lastChatId: null as number | null | undefined,
  pathname: "/",
  posthogCapture: vi.fn(),
  search: {} as { id?: number },
  selectedMode: "build",
  selectedModel: { provider: "openrouter", name: "test-model" },
  isQuotaExceeded: false,
  setChatMode: vi.fn(),
  settings: {
    selectedChatMode: "build",
  },
}));

vi.mock("./useChatMode", () => ({
  useChatMode: (chatId: number | null | undefined) => {
    mocks.lastChatId = chatId;
    return {
      selectedMode: mocks.selectedMode,
      selectedModel: mocks.selectedModel,
      setChatMode: mocks.setChatMode,
      settings: mocks.settings,
    };
  },
}));

vi.mock("./useFreeAgentQuota", () => ({
  useFreeAgentQuota: () => ({ isQuotaExceeded: mocks.isQuotaExceeded }),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({
    location: {
      pathname: mocks.pathname,
      search: mocks.search,
    },
  }),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({
    capture: mocks.posthogCapture,
  }),
}));

function makeWrapper() {
  const store = createStore();
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useChatModeToggle", () => {
  beforeEach(() => {
    mocks.lastChatId = null;
    mocks.pathname = "/";
    mocks.posthogCapture.mockReset();
    mocks.search = {};
    mocks.selectedMode = "build";
    mocks.selectedModel = { provider: "openrouter", name: "test-model" };
    mocks.isQuotaExceeded = false;
    mocks.setChatMode.mockReset();
    mocks.setChatMode.mockResolvedValue(undefined);
    mocks.settings = {
      selectedChatMode: "build",
    };
  });

  it("latches home shortcut mode changes as manual selections", () => {
    const { result } = renderHook(
      () => ({
        ...useChatModeToggle(),
        hasManuallySelectedChatMode: useAtomValue(
          hasManuallySelectedChatModeAtom,
        ),
      }),
      { wrapper: makeWrapper() },
    );

    expect(result.current.hasManuallySelectedChatMode).toBe(false);

    act(() => {
      result.current.toggleChatMode();
    });

    expect(mocks.lastChatId).toBeNull();
    expect(mocks.setChatMode).toHaveBeenCalledWith("ask");
    expect(result.current.hasManuallySelectedChatMode).toBe(true);
    expect(mocks.posthogCapture).toHaveBeenCalledWith("chat:mode_toggle", {
      from: "build",
      to: "ask",
      trigger: "keyboard_shortcut",
    });
  });

  it("does not latch chat-route shortcut mode changes", () => {
    mocks.pathname = "/chat";
    mocks.search = { id: 42 };

    const { result } = renderHook(
      () => ({
        ...useChatModeToggle(),
        hasManuallySelectedChatMode: useAtomValue(
          hasManuallySelectedChatModeAtom,
        ),
      }),
      { wrapper: makeWrapper() },
    );

    act(() => {
      result.current.toggleChatMode();
    });

    expect(mocks.lastChatId).toBe(42);
    expect(mocks.setChatMode).toHaveBeenCalledWith("ask");
    expect(result.current.hasManuallySelectedChatMode).toBe(false);
  });

  it("skips Basic Agent when free quota is exhausted", () => {
    mocks.selectedMode = "ask";
    mocks.isQuotaExceeded = true;

    const { result } = renderHook(() => useChatModeToggle(), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.toggleChatMode());

    expect(mocks.setChatMode).toHaveBeenCalledWith("plan");
  });

  it("cycles away from an already-selected exhausted Basic Agent", () => {
    mocks.selectedMode = "local-agent";
    mocks.isQuotaExceeded = true;

    const { result } = renderHook(() => useChatModeToggle(), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.toggleChatMode());

    expect(mocks.setChatMode).toHaveBeenCalledWith("plan");
  });

  it("skips Build when Dyad Free is selected", () => {
    mocks.selectedMode = "plan";
    mocks.selectedModel = { provider: "auto", name: "free-pro" };

    const { result } = renderHook(() => useChatModeToggle(), {
      wrapper: makeWrapper(),
    });

    act(() => result.current.toggleChatMode());

    expect(mocks.setChatMode).toHaveBeenCalledWith("ask");
  });
});

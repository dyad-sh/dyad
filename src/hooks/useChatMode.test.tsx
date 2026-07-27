import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hasManuallySelectedChatModeAtom } from "@/atoms/chatAtoms";
import type { Chat } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { UserSettings } from "@/lib/schemas";
import { useChatMode } from "./useChatMode";

const mocks = vi.hoisted(() => ({
  settings: {} as UserSettings,
  updateSettings: vi.fn(),
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { provider: "openrouter", name: "test-model" },
    providerSettings: {},
    selectedChatMode: "ask",
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    ...overrides,
  } as UserSettings;
}

function makeWrapper(manuallySelected = false, initialChat?: Chat) {
  const store = createStore();
  store.set(hasManuallySelectedChatModeAtom, manuallySelected);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (initialChat) {
    queryClient.setQueryData(
      queryKeys.chats.detail({ chatId: initialChat.id }),
      initialChat,
    );
  }

  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </Provider>
    );
  };
}

describe("useChatMode without an active chat", () => {
  beforeEach(() => {
    mocks.settings = makeSettings();
    mocks.updateSettings.mockReset();
  });

  it("shows the Agent default without persisting it", () => {
    const { result } = renderHook(() => useChatMode(null), {
      wrapper: makeWrapper(),
    });

    expect(result.current.selectedMode).toBe("local-agent");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("shows a current-session manual selection", () => {
    const { result } = renderHook(() => useChatMode(null), {
      wrapper: makeWrapper(true),
    });

    expect(result.current.selectedMode).toBe("ask");
  });
});

describe("useChatMode with an active chat", () => {
  beforeEach(() => {
    mocks.settings = makeSettings({ defaultChatMode: "local-agent" });
    mocks.updateSettings.mockReset();
  });

  it("uses the default without latching an implicit chat", () => {
    const chat = {
      id: 123,
      appId: 1,
      title: "",
      messages: [],
      chatMode: null,
    } satisfies Chat;

    const { result } = renderHook(() => useChatMode(chat.id), {
      wrapper: makeWrapper(false, chat),
    });

    expect(result.current.storedChatMode).toBeNull();
    expect(result.current.selectedMode).toBe("local-agent");
  });

  it("preserves an explicitly stored mode", () => {
    const chat = {
      id: 123,
      appId: 1,
      title: "",
      messages: [],
      chatMode: "plan",
    } satisfies Chat;

    const { result } = renderHook(() => useChatMode(chat.id), {
      wrapper: makeWrapper(false, chat),
    });

    expect(result.current.storedChatMode).toBe("plan");
    expect(result.current.selectedMode).toBe("plan");
  });
});

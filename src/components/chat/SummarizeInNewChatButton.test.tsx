import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  recentViewedChatIdsAtom,
  selectedChatIdAtom,
  sessionOpenedChatIdsAtom,
} from "@/atoms/chatAtoms";
import { useSummarizeInNewChat } from "./SummarizeInNewChatButton";

const mocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  createChat: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
  streamMessage: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { chat: { getChat: mocks.getChat, createChat: mocks.createChat } },
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: mocks.streamMessage }),
}));
vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

describe("useSummarizeInNewChat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getChat.mockResolvedValue({ chatMode: "local-agent" });
    mocks.createChat.mockResolvedValue(42);
  });

  it("opens the summary chat as a tab alongside existing tabs before streaming", async () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 7);
    store.set(selectedChatIdAtom, 10);
    store.set(sessionOpenedChatIdsAtom, new Set([10, 11]));
    store.set(recentViewedChatIdsAtom, [10, 11]);
    const Wrapper = ({ children }: PropsWithChildren) => (
      <Provider store={store}>{children}</Provider>
    );
    let tabStateAtStreamStart;
    mocks.streamMessage.mockImplementation(async () => {
      tabStateAtStreamStart = {
        selectedChatId: store.get(selectedChatIdAtom),
        openChatIds: [...store.get(sessionOpenedChatIdsAtom)],
        recentChatIds: store.get(recentViewedChatIdsAtom),
      };
    });
    const { result } = renderHook(() => useSummarizeInNewChat(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.handleSummarize();
    });

    expect(tabStateAtStreamStart).toEqual({
      selectedChatId: 42,
      openChatIds: [10, 11, 42],
      recentChatIds: [42, 10, 11],
    });
    expect(mocks.createChat).toHaveBeenCalledExactlyOnceWith({
      appId: 7,
      initialChatMode: "local-agent",
    });
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/chat",
      search: { id: 42, appId: 7 },
    });
    expect(mocks.streamMessage).toHaveBeenCalledExactlyOnceWith({
      prompt: "Summarize from chat-id=10",
      chatId: 42,
    });
    expect(mocks.showError).not.toHaveBeenCalled();
  });
});

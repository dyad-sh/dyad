import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  scrollToBottomRequestedChatIdsAtom,
  selectedChatIdAtom,
} from "@/atoms/chatAtoms";
import { useSelectChat } from "./useSelectChat";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

function makeHarness() {
  const store = createStore();
  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }
  return { store, wrapper: Wrapper };
}

describe("useSelectChat", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
  });

  it("only requests bottom scrolling when selection asks for it", () => {
    const { store, wrapper } = makeHarness();
    const { result } = renderHook(() => useSelectChat(), { wrapper });

    act(() => {
      result.current.selectChat({ chatId: 101, appId: 7 });
    });

    expect(store.get(selectedChatIdAtom)).toBe(101);
    expect(store.get(selectedAppIdAtom)).toBe(7);
    expect(store.get(scrollToBottomRequestedChatIdsAtom).has(101)).toBe(false);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/chat",
      search: { id: 101, appId: 7 },
    });

    act(() => {
      result.current.selectChat({
        chatId: 202,
        appId: 7,
        scrollToBottom: true,
      });
    });

    expect(store.get(selectedChatIdAtom)).toBe(202);
    expect(store.get(scrollToBottomRequestedChatIdsAtom)).toEqual(
      new Set([202]),
    );
  });
});

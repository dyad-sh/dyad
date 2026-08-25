import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { ChatPaneProvider, usePaneChatId } from "./ChatPaneContext";

describe("ChatPaneContext", () => {
  it("uses the pane chat id instead of the globally focused chat", () => {
    const store = createStore();
    store.set(selectedChatIdAtom, 10);

    const { result } = renderHook(() => usePaneChatId(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>
          <ChatPaneProvider chatId={20}>{children}</ChatPaneProvider>
        </Provider>
      ),
    });

    expect(result.current).toBe(20);
  });

  it("falls back to the focused chat outside a pane", () => {
    const store = createStore();
    store.set(selectedChatIdAtom, 10);

    const { result } = renderHook(() => usePaneChatId(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    });

    expect(result.current).toBe(10);
  });
});

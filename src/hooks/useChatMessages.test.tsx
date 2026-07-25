import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import type { Message } from "@/ipc/types";

import {
  useChatMessageCount,
  useChatMessages,
  useChatMessagesLoaded,
} from "./useChatMessages";

function makeHarness() {
  const store = createStore();
  function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  }
  return { store, Wrapper };
}

const message = (id: number): Message => ({
  id,
  role: "user",
  content: `message ${id}`,
});

describe("chat message reader hooks", () => {
  it("distinguishes an uninitialized chat from a loaded empty chat", () => {
    const { store, Wrapper } = makeHarness();
    const { result } = renderHook(
      () => ({
        messages: useChatMessages(7),
        loaded: useChatMessagesLoaded(7),
      }),
      { wrapper: Wrapper },
    );

    expect(result.current.messages).toEqual([]);
    expect(result.current.loaded).toBe(false);

    act(() => {
      store.set(chatMessagesByIdAtom, new Map([[7, []]]));
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.loaded).toBe(true);
  });

  it("does not rerender a chat reader when another chat changes", () => {
    const { store, Wrapper } = makeHarness();
    const chatMessages = [message(1)];
    store.set(chatMessagesByIdAtom, new Map([[7, chatMessages]]));
    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount += 1;
        return useChatMessages(7);
      },
      { wrapper: Wrapper },
    );
    const renderCountBeforeOtherChatUpdate = renderCount;

    act(() => {
      store.set(
        chatMessagesByIdAtom,
        new Map([
          [7, chatMessages],
          [8, [message(2)]],
        ]),
      );
    });

    expect(result.current).toBe(chatMessages);
    expect(renderCount).toBe(renderCountBeforeOtherChatUpdate);
  });

  it("exposes a primitive count for consumers that do not need messages", () => {
    const { store, Wrapper } = makeHarness();
    const { result } = renderHook(() => useChatMessageCount(7), {
      wrapper: Wrapper,
    });

    act(() => {
      store.set(chatMessagesByIdAtom, new Map([[7, [message(1), message(2)]]]));
    });

    expect(result.current).toBe(2);
  });
});

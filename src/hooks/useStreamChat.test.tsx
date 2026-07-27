import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queuedMessagesByIdAtom } from "@/atoms/chatAtoms";
import { useStreamChat } from "./useStreamChat";

const CHAT_ID = 42;

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  dispatchQueueEvent: vi.fn(async () => undefined),
  showError: vi.fn(),
  streamState: {
    current: {
      phase: "idle",
      capabilities: { canCancel: false },
      error: null,
    },
  } as {
    current: {
      phase: string;
      capabilities: { canCancel: boolean };
      error: string | null;
    };
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ id: CHAT_ID }),
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => ({
    ensure: () => ({
      send: mocks.send,
      getSnapshot: () => mocks.streamState.current,
      subscribe: () => () => undefined,
    }),
    dispatchQueueEvent: mocks.dispatchQueueEvent,
  }),
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
}));

function makeWrapper() {
  const store = createStore();
  const Wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, Wrapper };
}

describe("useStreamChat main-owned queue", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.dispatchQueueEvent.mockReset();
    mocks.dispatchQueueEvent.mockResolvedValue(undefined);
    mocks.showError.mockReset();
  });

  it("submits queue requests to the actor without writing renderer state", () => {
    const { store, Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    expect(
      result.current.queueMessage({ prompt: "queued during render lag" }),
    ).toBe(true);

    expect(store.get(queuedMessagesByIdAtom).has(CHAT_ID)).toBe(false);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
      type: "submit",
      request: {
        chatId: CHAT_ID,
        prompt: "queued during render lag",
      },
    });
  });

  it("routes edit, remove, reorder, and clear through revisioned actor intents", async () => {
    const { store, Wrapper } = makeWrapper();
    store.set(
      queuedMessagesByIdAtom,
      new Map([
        [
          CHAT_ID,
          [
            { id: "first", prompt: "First" },
            { id: "second", prompt: "Second" },
          ],
        ],
      ]),
    );
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    act(() => {
      result.current.updateQueuedMessage("first", { prompt: "Changed" });
      result.current.reorderQueuedMessages(0, 1);
    });
    await act(async () => {
      await result.current.removeQueuedMessage("second");
      await result.current.clearAllQueuedMessages();
    });

    await waitFor(() => {
      expect(mocks.dispatchQueueEvent).toHaveBeenCalledWith(CHAT_ID, {
        type: "EDIT_QUEUE_ENTRY",
        itemId: "first",
        prompt: "Changed",
        attachments: [],
        selectedComponents: undefined,
      });
    });
    expect(mocks.dispatchQueueEvent).toHaveBeenCalledWith(CHAT_ID, {
      type: "REORDER_QUEUE_ENTRY",
      itemId: "first",
      toIndex: 1,
    });
    expect(mocks.dispatchQueueEvent).toHaveBeenCalledWith(CHAT_ID, {
      type: "REMOVE_QUEUE_ENTRY",
      itemId: "second",
    });
    expect(mocks.dispatchQueueEvent).toHaveBeenCalledWith(CHAT_ID, {
      type: "CLEAR_QUEUE",
    });
  });

  it("surfaces authoritative queue rejection", async () => {
    const rejection = new Error("queue revision changed");
    mocks.dispatchQueueEvent.mockRejectedValueOnce(rejection);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.clearAllQueuedMessages();
    });

    expect(mocks.showError).toHaveBeenCalledWith(rejection);
  });
});

describe("useStreamChat lifecycle intents", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.streamState.current = {
      phase: "streaming",
      capabilities: { canCancel: true },
      error: null,
    };
  });

  it("cancels only while the remote capability permits it", () => {
    const { Wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useStreamChat(), {
      wrapper: Wrapper,
    });

    act(() => result.current.cancelStream());
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });

    mocks.streamState.current = {
      phase: "cancelling",
      capabilities: { canCancel: false },
      error: null,
    };
    rerender();
    act(() => result.current.cancelStream());
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("routes external errors through the main actor", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    act(() => result.current.setError("Approval failed"));

    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
      type: "external-error",
      error: "Approval failed",
    });
  });
});

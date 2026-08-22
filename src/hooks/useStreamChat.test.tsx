import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamChat } from "./useStreamChat";
import {
  CHAT_PROMPT_LENGTH_LIMIT_MESSAGE,
  MAX_CHAT_PROMPT_CHARS,
} from "@/shared/chatAttachmentLimits";

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
      queue: [],
      queuePaused: false,
      queueRevision: 7,
    },
  } as {
    current: {
      phase: string;
      capabilities: { canCancel: boolean };
      error: string | null;
      queue: Array<{
        itemId: string;
        prompt: string;
        attachments?: [];
        selectedComponents?: [];
      }>;
      queuePaused: boolean;
      queueRevision: number;
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
  const Wrapper = ({ children }: PropsWithChildren) => (
    <Provider>{children}</Provider>
  );
  return { Wrapper };
}

describe("useStreamChat main-owned queue", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.dispatchQueueEvent.mockReset();
    mocks.dispatchQueueEvent.mockResolvedValue(undefined);
    mocks.showError.mockReset();
  });

  it("submits queue requests to the actor without writing renderer state", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    expect(
      result.current.queueMessage({ prompt: "queued during render lag" }),
    ).toBe(true);

    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
      type: "submit",
      request: {
        chatId: CHAT_ID,
        prompt: "queued during render lag",
      },
    });
  });

  it("forwards authoritative acceptance callbacks to the actor", async () => {
    const onAccepted = vi.fn();
    const onAcceptanceRejected = vi.fn();
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.streamMessage({
        chatId: CHAT_ID,
        prompt: "repair checks",
        onAccepted,
        onAcceptanceRejected,
      });
    });

    expect(mocks.send).toHaveBeenCalledWith({
      type: "submit",
      request: expect.objectContaining({
        onAccepted,
        onAcceptanceRejected,
      }),
    });
  });

  it("routes edit, remove, reorder, and clear through revisioned actor intents", async () => {
    const { Wrapper } = makeWrapper();
    mocks.streamState.current.queue = [
      { itemId: "first", prompt: "First" },
      { itemId: "second", prompt: "Second" },
    ];
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
      expect(mocks.dispatchQueueEvent).toHaveBeenCalledWith(
        CHAT_ID,
        {
          type: "EDIT_QUEUE_ENTRY",
          itemId: "first",
          prompt: "Changed",
          attachments: [],
          selectedComponents: undefined,
        },
        7,
      );
    });
    expect(mocks.dispatchQueueEvent).toHaveBeenCalledWith(
      CHAT_ID,
      {
        type: "REORDER_QUEUE_ENTRY",
        itemId: "first",
        toIndex: 1,
      },
      7,
    );
    expect(mocks.dispatchQueueEvent).toHaveBeenCalledWith(
      CHAT_ID,
      {
        type: "REMOVE_QUEUE_ENTRY",
        itemId: "second",
      },
      7,
    );
    expect(mocks.dispatchQueueEvent).toHaveBeenCalledWith(
      CHAT_ID,
      {
        type: "CLEAR_QUEUE",
      },
      7,
    );
  });

  it("uses the rendered queue revision for pause and resume mutations", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    act(() => {
      result.current.pauseQueue();
      result.current.clearPauseOnly();
      result.current.resumeQueue();
    });

    expect(mocks.dispatchQueueEvent).toHaveBeenNthCalledWith(
      1,
      CHAT_ID,
      { type: "PAUSE_QUEUE" },
      7,
    );
    expect(mocks.dispatchQueueEvent).toHaveBeenNthCalledWith(
      2,
      CHAT_ID,
      { type: "RESUME_QUEUE" },
      7,
    );
    expect(mocks.dispatchQueueEvent).toHaveBeenNthCalledWith(
      3,
      CHAT_ID,
      { type: "RESUME_QUEUE" },
      7,
    );
  });

  it("rejects oversized prompts before submitting them to the actor", async () => {
    const onSettled = vi.fn();
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    let accepted = true;
    await act(async () => {
      accepted = await result.current.streamMessage({
        chatId: CHAT_ID,
        prompt: "a".repeat(MAX_CHAT_PROMPT_CHARS + 1),
        onSettled,
      });
    });

    expect(accepted).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.showError).toHaveBeenCalledExactlyOnceWith(
      CHAT_PROMPT_LENGTH_LIMIT_MESSAGE,
    );
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ success: false });
  });

  it("forwards acceptance rejection callbacks to the stream actor", async () => {
    const onAcceptanceRejected = vi.fn();
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    await act(() =>
      result.current.streamMessage({
        chatId: CHAT_ID,
        prompt: "preserve this draft",
        onAcceptanceRejected,
      }),
    );

    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({
      type: "submit",
      request: expect.objectContaining({ onAcceptanceRejected }),
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

  it("does not rebuild queued attachments when the queue is unchanged", () => {
    const { Wrapper } = makeWrapper();
    mocks.streamState.current.queue = [
      { itemId: "with-attachment", prompt: "Inspect", attachments: [] },
    ];
    const { result, rerender } = renderHook(() => useStreamChat(), {
      wrapper: Wrapper,
    });
    const firstProjection = result.current.queuedMessages;

    rerender();

    expect(result.current.queuedMessages).toBe(firstProjection);
  });
});

describe("useStreamChat lifecycle intents", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.streamState.current = {
      phase: "streaming",
      capabilities: { canCancel: true },
      error: null,
      queue: [],
      queuePaused: false,
      queueRevision: 7,
    };
  });

  it("keeps Stop dispatchable through cancellation settlement", () => {
    const { Wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useStreamChat(), {
      wrapper: Wrapper,
    });

    act(() => result.current.cancelStream());
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });

    mocks.streamState.current = {
      phase: "cancelling",
      capabilities: { canCancel: true },
      error: null,
      queue: [],
      queuePaused: false,
      queueRevision: 7,
    };
    rerender();
    act(() => result.current.cancelStream());
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenLastCalledWith({ type: "cancel" });
  });

  it("dispatches Stop for an optimistic admission", () => {
    mocks.streamState.current = {
      phase: "admitting",
      capabilities: { canCancel: false },
      error: null,
      queue: [],
      queuePaused: false,
      queueRevision: 7,
    };
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), { wrapper: Wrapper });

    act(() => result.current.cancelStream());

    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ type: "cancel" });
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

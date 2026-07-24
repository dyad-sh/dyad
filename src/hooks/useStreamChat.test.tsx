import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queuedMessagesByIdAtom } from "@/atoms/chatAtoms";

import { useStreamChat } from "./useStreamChat";

const CHAT_ID = 42;

const mocks = vi.hoisted(() => ({
  controllerSend: vi.fn(),
  rejectUserInputHandoff: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ id: CHAT_ID }),
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => ({
    ensure: () => ({ send: mocks.controllerSend }),
    rejectUserInputHandoff: mocks.rejectUserInputHandoff,
  }),
}));

function makeWrapper() {
  const store = createStore();
  const Wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, Wrapper };
}

describe("useStreamChat queueMessage", () => {
  beforeEach(() => {
    mocks.controllerSend.mockReset();
    mocks.rejectUserInputHandoff.mockReset();
    mocks.rejectUserInputHandoff.mockResolvedValue(undefined);
  });

  it("pokes the stream machine after manually appending the queued message", () => {
    const { store, Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), {
      wrapper: Wrapper,
    });

    mocks.controllerSend.mockImplementationOnce(() => {
      expect(store.get(queuedMessagesByIdAtom).get(CHAT_ID)).toMatchObject([
        { prompt: "queued during render lag" },
      ]);
    });

    let queued = false;
    act(() => {
      queued = result.current.queueMessage({
        prompt: "queued during render lag",
      });
    });

    expect(queued).toBe(true);
    expect(mocks.controllerSend).toHaveBeenCalledExactlyOnceWith({
      type: "queue-poked",
    });
  });

  it("does not edit machine follow-ups and settles them before removal", async () => {
    const { store, Wrapper } = makeWrapper();
    const machineFollowUp = {
      id: "machine-follow-up",
      prompt: "Continue after integration",
      owner: {
        kind: "user-input-follow-up" as const,
        requestId: "integration:1",
      },
    };
    const ordinaryPrompt = {
      id: "ordinary-prompt",
      prompt: "Ordinary prompt",
    };
    store.set(
      queuedMessagesByIdAtom,
      new Map([[CHAT_ID, [machineFollowUp, ordinaryPrompt]]]),
    );
    const { result } = renderHook(() => useStreamChat(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.updateQueuedMessage(machineFollowUp.id, {
        prompt: "Changed",
      });
    });
    expect(store.get(queuedMessagesByIdAtom).get(CHAT_ID)?.[0].prompt).toBe(
      machineFollowUp.prompt,
    );

    await act(async () => {
      await result.current.removeQueuedMessage(machineFollowUp.id);
    });
    expect(mocks.rejectUserInputHandoff).toHaveBeenCalledWith(
      machineFollowUp.owner,
      "removed from queue",
    );
    expect(store.get(queuedMessagesByIdAtom).get(CHAT_ID)).toEqual([
      ordinaryPrompt,
    ]);

    await act(async () => {
      await result.current.clearAllQueuedMessages();
    });
    expect(store.get(queuedMessagesByIdAtom).has(CHAT_ID)).toBe(false);
  });

  it("preserves messages queued while bulk owner rejection is pending", async () => {
    const { store, Wrapper } = makeWrapper();
    let finishRejection!: () => void;
    mocks.rejectUserInputHandoff.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRejection = resolve;
      }),
    );
    store.set(
      queuedMessagesByIdAtom,
      new Map([
        [
          CHAT_ID,
          [
            {
              id: "owned-at-clear",
              prompt: "Continue after integration",
              owner: {
                kind: "user-input-follow-up",
                requestId: "integration:clear",
              },
            },
          ],
        ],
      ]),
    );
    const { result } = renderHook(() => useStreamChat(), {
      wrapper: Wrapper,
    });

    let clear!: Promise<void>;
    act(() => {
      clear = result.current.clearAllQueuedMessages();
    });
    act(() => {
      store.set(queuedMessagesByIdAtom, (previous) => {
        const next = new Map(previous);
        next.set(CHAT_ID, [
          ...(previous.get(CHAT_ID) ?? []),
          { id: "queued-during-clear", prompt: "Keep me" },
        ]);
        return next;
      });
      finishRejection();
    });
    await act(async () => clear);

    expect(store.get(queuedMessagesByIdAtom).get(CHAT_ID)).toEqual([
      { id: "queued-during-clear", prompt: "Keep me" },
    ]);
  });
});

describe("useStreamChat cancelStream", () => {
  beforeEach(() => {
    mocks.controllerSend.mockReset();
  });

  it("routes cancellation through the stream machine", () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreamChat(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.cancelStream();
    });

    expect(mocks.controllerSend).toHaveBeenCalledExactlyOnceWith({
      type: "cancel",
    });
  });
});

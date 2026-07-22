import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queuedMessagesByIdAtom } from "@/atoms/chatAtoms";

import { useStreamChat } from "./useStreamChat";

const CHAT_ID = 42;

const mocks = vi.hoisted(() => ({
  controllerSend: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ id: CHAT_ID }),
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => ({
    ensure: () => ({ send: mocks.controllerSend }),
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

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  pendingContinuationProviderAtom,
  pendingIntegrationAtom,
} from "@/atoms/integrationAtoms";
import type { StreamFinishedEvent } from "@/chat_stream/manager";

import { useIntegrationContinuation } from "./useIntegrationContinuation";

const CHAT_ID = 42;

const mocks = vi.hoisted(() => ({
  streamFinishedCallback: undefined as
    | ((event: StreamFinishedEvent) => void)
    | undefined,
  streamMessage: vi.fn(),
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useStreamFinished: (callback: (event: StreamFinishedEvent) => void) => {
    mocks.streamFinishedCallback = callback;
  },
}));

vi.mock("./useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: mocks.streamMessage }),
}));

function makeWrapper() {
  const store = createStore();
  const Wrapper = ({ children }: PropsWithChildren) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, Wrapper };
}

describe("useIntegrationContinuation", () => {
  beforeEach(() => {
    mocks.streamFinishedCallback = undefined;
    mocks.streamMessage.mockReset();
  });

  it("reads a continuation written in the same batch as the terminal event", () => {
    const { store, Wrapper } = makeWrapper();
    renderHook(() => useIntegrationContinuation(), { wrapper: Wrapper });

    act(() => {
      store.set(
        pendingContinuationProviderAtom,
        new Map([[CHAT_ID, "supabase"]]),
      );
      store.set(
        pendingIntegrationAtom,
        new Map([
          [
            CHAT_ID,
            {
              requestId: "request-1",
              chatId: CHAT_ID,
              provider: "supabase",
            },
          ],
        ]),
      );
      mocks.streamFinishedCallback?.({
        chatId: CHAT_ID,
        streamId: 1,
        outcome: "completed",
      });
    });

    expect(mocks.streamMessage).toHaveBeenCalledExactlyOnceWith({
      chatId: CHAT_ID,
      prompt: "Continue. I have completed the supabase integration.",
    });
    expect(store.get(pendingContinuationProviderAtom).has(CHAT_ID)).toBe(false);
    expect(store.get(pendingIntegrationAtom).has(CHAT_ID)).toBe(true);
  });
});

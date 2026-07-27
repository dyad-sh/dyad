import type { PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import { ChatStreamProvider } from "@/chat_stream/ChatStreamProvider";
import { ChatStreamRemoteManager } from "@/chat_stream/remote_manager";

import { useChatStreamHasPreview } from "./useChatStream";

describe("useChatStreamHasPreview", () => {
  it("rerenders only when preview presence changes", () => {
    const manager = new ChatStreamRemoteManager(createStore());
    let renderCount = 0;
    const wrapper = ({ children }: PropsWithChildren) => (
      <ChatStreamProvider manager={manager}>{children}</ChatStreamProvider>
    );

    const { result, unmount } = renderHook(
      () => {
        renderCount += 1;
        return useChatStreamHasPreview(7);
      },
      { wrapper },
    );

    expect(result.current).toBe(false);
    expect(renderCount).toBe(1);

    act(() => {
      manager.setPreview(7, "first chunk");
    });
    expect(result.current).toBe(true);
    expect(renderCount).toBe(2);

    act(() => {
      manager.setPreview(7, "second chunk");
    });
    expect(result.current).toBe(true);
    expect(renderCount).toBe(2);

    act(() => {
      manager.setPreview(7, "");
    });
    expect(result.current).toBe(false);
    expect(renderCount).toBe(3);

    unmount();
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isChatNearBottom, useChatAutoScroll } from "./useChatAutoScroll";

afterEach(() => {
  vi.useRealTimers();
});

function scrollElement({
  scrollHeight,
  scrollTop,
  clientHeight,
}: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}) {
  return { scrollHeight, scrollTop, clientHeight } as HTMLElement;
}

describe("isChatNearBottom", () => {
  it("keeps following while the reader is within the bottom threshold", () => {
    expect(
      isChatNearBottom(
        scrollElement({
          scrollHeight: 1_000,
          scrollTop: 520,
          clientHeight: 400,
        }),
      ),
    ).toBe(true);
  });

  it("stops following after the reader scrolls up", () => {
    expect(
      isChatNearBottom(
        scrollElement({
          scrollHeight: 1_000,
          scrollTop: 300,
          clientHeight: 400,
        }),
      ),
    ).toBe(false);
  });
});

describe("useChatAutoScroll", () => {
  it("does not mistake its delayed scroll event for the reader scrolling up", () => {
    vi.useFakeTimers();
    const element = scrollElement({
      scrollHeight: 1_000,
      scrollTop: 600,
      clientHeight: 400,
    });
    const { result } = renderHook(() =>
      useChatAutoScroll({
        conversationId: "chat-1",
        contentVersion: "first chunk",
        isStreaming: true,
      }),
    );
    result.current.scrollRef.current = element as HTMLDivElement;

    act(() => result.current.scrollToBottom());
    // Another large chunk lands before the scroll event from our assignment.
    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      value: 2_000,
    });
    act(() => result.current.handleScroll({ currentTarget: element } as never));

    expect(result.current.isFollowing).toBe(true);

    act(() =>
      result.current.scrollIntentHandlers.onWheel({ deltaY: -20 } as never),
    );
    expect(result.current.isFollowing).toBe(false);
  });
});

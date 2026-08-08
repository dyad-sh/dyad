import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useChatAutoScroll } from "@/hooks/useChatAutoScroll";

function scrollEvent(distanceFromBottom: number) {
  return {
    currentTarget: {
      scrollHeight: 2000,
      clientHeight: 600,
      scrollTop: 2000 - 600 - distanceFromBottom,
    },
  } as unknown as React.UIEvent<HTMLDivElement>;
}

function render() {
  return renderHook(() =>
    useChatAutoScroll({
      conversationId: "c1",
      contentVersion: 0,
      isStreaming: true,
    }),
  );
}

describe("programmatic scroll guard", () => {
  it("keeps following while the jump glide passes far-from-bottom positions", () => {
    const { result } = render();

    // Reader scrolled up: following stops.
    act(() => result.current.handleScroll(scrollEvent(500)));
    expect(result.current.isFollowing).toBe(false);

    // They click the button; the smooth glide fires scroll events at
    // positions that look exactly like scrolling up.
    act(() => result.current.followLatest());
    act(() => result.current.handleScroll(scrollEvent(420)));
    act(() => result.current.handleScroll(scrollEvent(260)));

    // The glide must not cancel the follow it was asked to resume.
    expect(result.current.isFollowing).toBe(true);
  });

  it("hands control back to the user once the glide arrives", () => {
    const { result } = render();
    act(() => result.current.handleScroll(scrollEvent(500)));
    act(() => result.current.followLatest());
    // Glide lands at the bottom, guard disarms…
    act(() => result.current.handleScroll(scrollEvent(0)));
    expect(result.current.isFollowing).toBe(true);

    // …so the user scrolling up afterwards works immediately again.
    act(() => result.current.handleScroll(scrollEvent(500)));
    expect(result.current.isFollowing).toBe(false);
  });

  it("clears the pending badge when jumping back", () => {
    const { result, rerender } = renderHook(
      ({ version }: { version: number }) =>
        useChatAutoScroll({
          conversationId: "c1",
          contentVersion: version,
          isStreaming: true,
        }),
      { initialProps: { version: 0 } },
    );

    act(() => result.current.handleScroll(scrollEvent(500)));
    rerender({ version: 1 });
    rerender({ version: 2 });
    expect(result.current.pendingCount).toBe(2);

    act(() => result.current.followLatest());
    expect(result.current.pendingCount).toBe(0);
  });
});

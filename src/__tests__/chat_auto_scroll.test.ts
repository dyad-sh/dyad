import { describe, expect, it } from "vitest";

import {
  CHAT_BOTTOM_THRESHOLD_PX,
  isChatNearBottom,
} from "@/hooks/useChatAutoScroll";

function scroller({
  scrollHeight,
  scrollTop,
  clientHeight,
}: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): HTMLElement {
  return { scrollHeight, scrollTop, clientHeight } as HTMLElement;
}

describe("isChatNearBottom", () => {
  it("counts the very bottom as near", () => {
    expect(
      isChatNearBottom(
        scroller({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 600 }),
      ),
    ).toBe(true);
  });

  it("follows a reader who has drifted a little", () => {
    // 150px from the bottom: still reading along.
    expect(
      isChatNearBottom(
        scroller({ scrollHeight: 2000, scrollTop: 1250, clientHeight: 600 }),
      ),
    ).toBe(true);
  });

  it("leaves alone a reader who scrolled up", () => {
    // 400px up: deliberately re-reading, so do not drag them down.
    expect(
      isChatNearBottom(
        scroller({ scrollHeight: 2000, scrollTop: 1000, clientHeight: 600 }),
      ),
    ).toBe(false);
  });

  it("uses the documented 200px threshold", () => {
    expect(CHAT_BOTTOM_THRESHOLD_PX).toBe(200);

    const exactlyAtThreshold = scroller({
      scrollHeight: 2000,
      scrollTop: 1200,
      clientHeight: 600,
    });
    expect(isChatNearBottom(exactlyAtThreshold)).toBe(true);

    const justPast = scroller({
      scrollHeight: 2000,
      scrollTop: 1199,
      clientHeight: 600,
    });
    expect(isChatNearBottom(justPast)).toBe(false);
  });

  it("accepts a custom threshold", () => {
    const element = scroller({
      scrollHeight: 2000,
      scrollTop: 1000,
      clientHeight: 600,
    });
    expect(isChatNearBottom(element, 500)).toBe(true);
    expect(isChatNearBottom(element, 100)).toBe(false);
  });

  it("treats a conversation shorter than the viewport as at the bottom", () => {
    expect(
      isChatNearBottom(
        scroller({ scrollHeight: 400, scrollTop: 0, clientHeight: 600 }),
      ),
    ).toBe(true);
  });
});

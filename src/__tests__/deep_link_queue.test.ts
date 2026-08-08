import { describe, expect, it, vi } from "vitest";
import { createDeepLinkQueue } from "@/main/deep_link_queue";

describe("createDeepLinkQueue", () => {
  it("queues deep links until the app is marked ready", () => {
    const handler = vi.fn();
    const queue = createDeepLinkQueue(handler);

    queue.handle("dyad://one");
    queue.handle("dyad://two");

    expect(handler).not.toHaveBeenCalled();

    queue.markReady();

    expect(handler).toHaveBeenNthCalledWith(1, "dyad://one");
    expect(handler).toHaveBeenNthCalledWith(2, "dyad://two");
  });

  it("handles deep links immediately after the app is marked ready", () => {
    const handler = vi.fn();
    const queue = createDeepLinkQueue(handler);

    queue.markReady();
    queue.handle("dyad://ready");
    queue.markReady();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith("dyad://ready");
  });
});

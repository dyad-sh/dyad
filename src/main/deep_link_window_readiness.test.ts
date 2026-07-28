import { describe, expect, it, vi } from "vitest";
import { createDeepLinkQueue } from "@/main/deep_link_queue";
import { DeepLinkWindowReadiness } from "@/main/deep_link_window_readiness";

describe("DeepLinkWindowReadiness", () => {
  it("waits for the targeted restored window rather than the first to load", () => {
    const delivered: Array<{ target: object | null; url: string }> = [];
    let target: object | null = null;
    const queue = createDeepLinkQueue((url) => {
      delivered.push({ target, url });
    });
    const readiness = new DeepLinkWindowReadiness<object>(queue);
    const firstWindow = {};
    const targetWindow = {};

    target = targetWindow;
    readiness.setTarget(targetWindow);
    queue.handle("dyad://cold-start");
    readiness.markReady(firstWindow);
    expect(delivered).toEqual([]);

    readiness.markReady(targetWindow);
    expect(delivered).toEqual([
      { target: targetWindow, url: "dyad://cold-start" },
    ]);
  });

  it("re-queues while a new target loads and follows a ready focus target", () => {
    const handler = vi.fn();
    const queue = createDeepLinkQueue(handler);
    const readiness = new DeepLinkWindowReadiness<object>(queue);
    const readyWindow = {};
    const loadingWindow = {};

    readiness.setTarget(readyWindow);
    readiness.markReady(readyWindow);
    readiness.setTarget(loadingWindow);
    queue.handle("dyad://while-loading");
    expect(handler).not.toHaveBeenCalled();

    readiness.setTarget(readyWindow);
    expect(handler).toHaveBeenCalledWith("dyad://while-loading");
  });

  it("marks a reloading target unavailable until its next completed load", () => {
    const handler = vi.fn();
    const queue = createDeepLinkQueue(handler);
    const readiness = new DeepLinkWindowReadiness<object>(queue);
    const window = {};
    readiness.setTarget(window);
    readiness.markReady(window);

    readiness.markNotReady(window);
    queue.handle("dyad://during-reload");
    expect(handler).not.toHaveBeenCalled();

    readiness.markReady(window);
    expect(handler).toHaveBeenCalledWith("dyad://during-reload");
  });
});

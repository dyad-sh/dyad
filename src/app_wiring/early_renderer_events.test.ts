import { describe, expect, it, vi } from "vitest";
import { ReplayEvent } from "@/app_wiring/early_renderer_events";

describe("ReplayEvent", () => {
  it("replays events emitted before the React consumer subscribes", () => {
    const event = new ReplayEvent<string>();
    const listener = vi.fn();
    event.emit("cold-start");

    event.subscribe(listener);

    expect(listener).toHaveBeenCalledWith("cold-start");
  });

  it("delivers live events once and buffers during remount gaps", () => {
    const event = new ReplayEvent<string>();
    const firstListener = vi.fn();
    const unsubscribe = event.subscribe(firstListener);
    event.emit("live");
    unsubscribe();
    event.emit("between-mounts");

    const replacementListener = vi.fn();
    event.subscribe(replacementListener);

    expect(firstListener).toHaveBeenCalledWith("live");
    expect(replacementListener).toHaveBeenCalledWith("between-mounts");
  });
});

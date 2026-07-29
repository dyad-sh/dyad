import { describe, expect, it, vi } from "vitest";

const eventHandlers = vi.hoisted(() => ({
  deepLink: vi.fn(),
  forceClose: vi.fn(),
  telemetry: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    events: {
      misc: {
        onDeepLinkReceived: vi.fn((handler) => {
          eventHandlers.deepLink = handler;
          return vi.fn();
        }),
      },
      system: {
        onForceCloseDetected: vi.fn((handler) => {
          eventHandlers.forceClose = handler;
          return vi.fn();
        }),
        onTelemetryEvent: vi.fn((handler) => {
          eventHandlers.telemetry = handler;
          return vi.fn();
        }),
      },
    },
  },
}));

import {
  earlyTelemetryEvents,
  registerEarlyRendererEvents,
  ReplayEvent,
} from "@/app_wiring/early_renderer_events";

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

  it("buffers telemetry emitted before renderer services mount", () => {
    const listener = vi.fn();
    const payload = {
      eventName: "app:crash_detected",
      properties: { crashType: "force_close" },
    };
    registerEarlyRendererEvents();

    eventHandlers.telemetry(payload);
    earlyTelemetryEvents.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(payload);
  });
});

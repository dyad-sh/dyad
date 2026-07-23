import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { createScreenshotCommandAdapter } from "./commands";
import { ScreenshotController } from "./controller";

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      getCurrentCommitHash: vi.fn(() =>
        Promise.resolve({ commitHash: "abc123" }),
      ),
      listAppScreenshots: vi.fn(() => Promise.resolve({ screenshots: [{}] })),
      saveAppScreenshot: vi.fn(() => Promise.resolve()),
    },
  },
}));

describe("screenshot controller", () => {
  it("uses the injected clock for the settle delay", async () => {
    const clock = createFakeClock();
    const adapter = createScreenshotCommandAdapter({
      clock,
      idSource: createSequentialIdSource(),
      queryClient: {
        invalidateQueries: vi.fn(() => Promise.resolve()),
      } as unknown as QueryClient,
    });
    const postMessage = vi.fn();
    adapter.attach(7, postMessage);
    const controller = new ScreenshotController(7, adapter);

    controller.send({ type: "IFRAME_LOADED" });
    controller.send({ type: "SELECTOR_READY" });
    controller.send({ type: "CAPTURE_REQUESTED", source: "commit" });
    expect(controller.getSnapshot().status).toBe("settling");
    expect(clock.pendingTimerCount()).toBe(1);

    clock.advanceBy(2_999);
    expect(controller.getSnapshot().status).toBe("settling");
    clock.advanceBy(1);
    expect(controller.getSnapshot().status).toBe("resolvingCommit");

    await vi.waitFor(() => {
      expect(controller.getSnapshot()).toMatchObject({
        status: "awaitingResponse",
        requestId: "screenshot-capture:1",
      });
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: "dyad-take-screenshot",
      requestId: "screenshot-capture:1",
    });
  });

  it("settles an untagged iframe without waiting forever for selector readiness", async () => {
    const clock = createFakeClock();
    const adapter = createScreenshotCommandAdapter({
      clock,
      idSource: createSequentialIdSource(),
      queryClient: {
        invalidateQueries: vi.fn(() => Promise.resolve()),
      } as unknown as QueryClient,
    });
    const postMessage = vi.fn();
    adapter.attach(7, postMessage);
    const controller = new ScreenshotController(7, adapter);

    controller.send({ type: "CAPTURE_REQUESTED", source: "commit" });
    controller.send({ type: "IFRAME_LOADED" });
    expect(controller.getSnapshot().status).toBe("waitingSelectorReady");

    clock.advanceBy(3_000);

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({
        type: "dyad-take-screenshot",
        requestId: "screenshot-capture:1",
      });
    });
  });

  it("drops routed responses after the app controller is disposed", () => {
    const ignored = vi.fn();
    const runner = {
      execute: vi.fn(),
      disposeKey: vi.fn(),
    };
    const controller = new ScreenshotController(7, runner, {
      onEventIgnored: ignored,
    });
    controller.send({ type: "CAPTURE_REQUESTED", source: "commit" });
    controller.dispose();
    controller.send({
      type: "RESPONSE",
      requestId: "capture:late",
      ok: true,
      dataUrl: "data:image/png;base64,late",
    });
    expect(ignored).not.toHaveBeenCalled();
    expect(runner.disposeKey).toHaveBeenCalledWith(7);
  });

  it("reports stale adapter correlation without disturbing the active request", () => {
    const ignored = vi.fn();
    const runner = {
      execute: vi.fn(),
      disposeKey: vi.fn(),
    };
    const controller = new ScreenshotController(7, runner, {
      onEventIgnored: ignored,
    });
    controller.send({ type: "IFRAME_LOADED" });
    controller.send({ type: "SELECTOR_READY" });
    controller.send({ type: "CAPTURE_REQUESTED", source: "commit" });
    controller.send({
      type: "SETTLE_ELAPSED",
      requestId: "capture:current",
    });
    controller.send({
      type: "COMMIT_RESOLVED",
      hash: "abc123",
      requestId: "capture:current",
    });

    controller.send({
      type: "RESPONSE",
      requestId: "capture:stale",
      ok: true,
      dataUrl: "data:image/png;base64,stale",
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "awaitingResponse",
      requestId: "capture:current",
    });
    expect(ignored).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "stale-request" }),
    );
  });

  it("recovers when an active command throws synchronously", () => {
    const runner = {
      execute: vi.fn((_appId, command) => {
        if (command.type === "schedule-settle") {
          throw new Error("clock unavailable");
        }
      }),
      disposeKey: vi.fn(),
    };
    const controller = new ScreenshotController(7, runner);

    controller.send({ type: "IFRAME_LOADED" });
    controller.send({ type: "SELECTOR_READY" });
    controller.send({ type: "CAPTURE_REQUESTED", source: "commit" });

    expect(controller.getSnapshot().status).toBe("idle");
  });

  it("preserves queued work when posting throws synchronously", () => {
    const runner = {
      execute: vi.fn((_appId, command) => {
        if (command.type === "post-capture-request") {
          throw new Error("iframe unavailable");
        }
      }),
      disposeKey: vi.fn(),
    };
    const controller = new ScreenshotController(7, runner);

    controller.send({ type: "IFRAME_LOADED" });
    controller.send({ type: "SELECTOR_READY" });
    controller.send({ type: "CAPTURE_REQUESTED", source: "commit" });
    controller.send({
      type: "SETTLE_ELAPSED",
      requestId: "capture:current",
    });
    controller.send({ type: "CAPTURE_REQUESTED", source: "stream" });
    controller.send({
      type: "COMMIT_RESOLVED",
      hash: "abc123",
      requestId: "capture:current",
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "settling",
      source: "stream",
    });
  });
});

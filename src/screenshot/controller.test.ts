import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import type { TransitionObserver } from "@/state_machines/types";
import { createScreenshotCommandAdapter } from "./commands";
import { ScreenshotController } from "./controller";
import type {
  ScreenshotCommand,
  ScreenshotEvent,
  ScreenshotIgnoreReason,
  ScreenshotState,
} from "./state";
import { INITIAL_SCREENSHOT_STATE } from "./state";
import { transition } from "./transition";

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

interface ScreenshotTrace {
  outcomes: string[];
  states: ScreenshotState[];
  commands: ScreenshotCommand[];
}

class RecordedScreenshotController {
  private state = INITIAL_SCREENSHOT_STATE;

  constructor(
    private readonly runner: {
      execute(
        appId: number,
        command: ScreenshotCommand,
        emit: (event: ScreenshotEvent) => void,
      ): void;
    },
    private readonly observer: TransitionObserver<
      ScreenshotState,
      ScreenshotEvent,
      ScreenshotCommand,
      ScreenshotIgnoreReason
    >,
  ) {}

  getSnapshot(): ScreenshotState {
    return this.state;
  }

  send = (event: ScreenshotEvent): void => {
    const previous = this.state;
    const result = transition(previous, event);
    if (result.kind === "ignored") {
      this.observer.onEventIgnored?.({
        state: previous,
        event,
        reason: result.reason,
      });
      return;
    }
    this.observer.onTransitionApplied?.({
      previous,
      event,
      state: result.state,
      commands: result.commands,
    });
    this.state = result.state;
    for (const command of result.commands) {
      this.runner.execute(7, command, this.send);
    }
  };
}

function recordScreenshotScenario(
  kind: "reference" | "controller",
): ScreenshotTrace {
  const trace: ScreenshotTrace = { outcomes: [], states: [], commands: [] };
  let settleId = 0;
  const observer: TransitionObserver<
    ScreenshotState,
    ScreenshotEvent,
    ScreenshotCommand,
    ScreenshotIgnoreReason
  > = {
    onTransitionApplied({ event, state }) {
      trace.outcomes.push(`applied:${event.type}`);
      trace.states.push(state);
    },
    onEventIgnored({ event, state, reason }) {
      trace.outcomes.push(`ignored:${event.type}:${reason}`);
      trace.states.push(state);
    },
  };
  const runner = {
    execute(
      _appId: number,
      command: ScreenshotCommand,
      emit: (event: ScreenshotEvent) => void,
    ) {
      trace.commands.push(command);
      if (command.type === "schedule-settle") {
        settleId += 1;
        emit({ type: "SETTLE_ELAPSED", requestId: `capture:${settleId}` });
      } else if (command.type === "resolve-commit-hash") {
        emit({
          type: "COMMIT_RESOLVED",
          requestId: command.requestId,
          hash: "abc123",
        });
      }
    },
    disposeKey() {},
  };
  const controller =
    kind === "reference"
      ? new RecordedScreenshotController(runner, observer)
      : new ScreenshotController(7, runner, observer);

  controller.send({ type: "IFRAME_LOADED" });
  controller.send({ type: "SELECTOR_READY" });
  controller.send({ type: "CAPTURE_REQUESTED", source: "commit" });
  controller.send({ type: "CAPTURE_REQUESTED", source: "stream" });
  controller.send({
    type: "RESPONSE",
    requestId: "capture:stale",
    ok: false,
  });
  controller.send({ type: "RESPONSE", requestId: "capture:1", ok: false });
  trace.states.push(controller.getSnapshot());
  return trace;
}

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

  it("matches the recorded pre-migration event, state, and command trace", () => {
    expect(recordScreenshotScenario("controller")).toEqual(
      recordScreenshotScenario("reference"),
    );
  });
});

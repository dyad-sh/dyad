import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { DispatcherError } from "@/state_machines/dispatcher";
import {
  createFakeClock,
  createSequentialIdSource,
  runControllerConformanceSuite,
  type ControllerConformanceAdapter,
} from "@/state_machines/testing";
import type {
  TransitionObserver,
  TransitionResult,
} from "@/state_machines/types";
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
  states: unknown[];
  commands: ScreenshotCommand["type"][];
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
      trace.states.push(withoutSettleToken(state));
    },
    onEventIgnored({ event, state, reason }) {
      trace.outcomes.push(`ignored:${event.type}:${reason}`);
      trace.states.push(withoutSettleToken(state));
    },
  };
  const runner = {
    execute(
      _appId: number,
      command: ScreenshotCommand,
      emit: (event: ScreenshotEvent) => void,
    ) {
      trace.commands.push(command.type);
      if (command.type === "schedule-settle") {
        settleId += 1;
        emit({
          type: "SETTLE_ELAPSED",
          requestId: `capture:${settleId}`,
          settleToken: command.settleToken,
        });
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
  trace.states.push(withoutSettleToken(controller.getSnapshot()));
  return trace;
}

function withoutSettleToken(state: ScreenshotState): unknown {
  const { settleToken: _settleToken, ...rest } = state;
  return rest;
}

type ScreenshotConformanceStep =
  | ScreenshotEvent
  | { readonly test: "settle" }
  | { readonly test: "commit" }
  | { readonly test: "response" };

interface ScreenshotConformanceEvent {
  readonly type: "CONFORMANCE_SEQUENCE";
  readonly steps: readonly ScreenshotConformanceStep[];
  readonly command?: ScreenshotCommand;
}

function runScreenshotConformanceTransition(
  state: ScreenshotState,
  event: ScreenshotConformanceEvent,
): TransitionResult<
  ScreenshotState,
  ScreenshotCommand,
  ScreenshotIgnoreReason
> {
  let current = state;
  let last: TransitionResult<
    ScreenshotState,
    ScreenshotCommand,
    ScreenshotIgnoreReason
  > = {
    kind: "ignored",
    state,
    reason: "already-hidden",
  };
  for (const step of event.steps) {
    last = transition(current, materializeScreenshotStep(step, current));
    current = last.state;
  }
  return last;
}

function materializeScreenshotStep(
  step: ScreenshotConformanceStep,
  state: ScreenshotState,
): ScreenshotEvent {
  if (!("test" in step)) return step;
  switch (step.test) {
    case "settle":
      return {
        type: "SETTLE_ELAPSED",
        requestId: "conformance:capture",
        settleToken: state.settleToken,
      };
    case "commit":
      return {
        type: "COMMIT_RESOLVED",
        requestId: "conformance:capture",
        hash: "abc123",
      };
    case "response":
      return {
        type: "RESPONSE",
        requestId: "conformance:capture",
        ok: true,
        dataUrl: "data:image/png;base64,conformance",
      };
  }
}

function createScreenshotConformanceAdapter(): ControllerConformanceAdapter<
  ScreenshotState,
  ScreenshotConformanceEvent,
  ScreenshotCommand,
  ScreenshotIgnoreReason
> {
  const sequence = (
    ...steps: ScreenshotConformanceStep[]
  ): ScreenshotConformanceEvent => ({
    type: "CONFORMANCE_SEQUENCE",
    steps,
  });
  const syncThrow: ScreenshotCommand = { type: "cancel-settle" };
  const asyncReject: ScreenshotCommand = { type: "cancel-settle" };
  const emitCommand: ScreenshotCommand = {
    type: "check-existing-screenshots",
  };
  let deferredId = 0;

  return {
    initialState: INITIAL_SCREENSHOT_STATE,
    transition: runScreenshotConformanceTransition,
    create(options) {
      let expectedCommand: ScreenshotCommand | undefined;
      let disposed = false;
      let sendConformanceEvent: (
        event: ScreenshotConformanceEvent,
      ) => void = () => undefined;
      const controller = new ScreenshotController(
        7,
        {
          execute(_appId, command) {
            const presented = expectedCommand ?? command;
            expectedCommand = undefined;
            if (presented === emitCommand) {
              sendConformanceEvent(sequence({ type: "IFRAME_LOADED" }));
              return;
            }
            return options.runCommand(presented, sendConformanceEvent);
          },
          beforeStateCommit(_appId, previous, next) {
            options.beforeCommit?.(previous, next);
          },
          disposeKey() {},
        },
        options.observer as unknown as TransitionObserver<
          ScreenshotState,
          ScreenshotEvent,
          ScreenshotCommand,
          ScreenshotIgnoreReason
        >,
        options.reportError,
      );
      sendConformanceEvent = (event) => {
        for (const step of event.steps) {
          controller.send(
            materializeScreenshotStep(step, controller.getSnapshot()),
          );
        }
      };
      return {
        getSnapshot: () =>
          disposed ? INITIAL_SCREENSHOT_STATE : controller.getSnapshot(),
        subscribe: controller.subscribe,
        send(event) {
          expectedCommand = event.command;
          sendConformanceEvent(event);
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          const state = controller.getSnapshot();
          controller.dispose();
          for (const command of options.disposeCommands?.(state) ?? []) {
            void options.runCommand(command, () => undefined);
          }
          options.cleanupProjection?.();
          options.releaseWriter?.();
          options.onDisposed?.();
        },
      };
    },
    events: {
      enterA: sequence({ type: "SELECTOR_READY" }),
      enterB: sequence({ type: "IFRAME_LOADED" }),
      finish: sequence({ type: "APP_HIDDEN" }),
      command(command) {
        return {
          ...sequence({ type: "SELECTOR_READY" }),
          command,
        };
      },
    },
    errorStage: (error) => (error as DispatcherError<ScreenshotCommand>).stage,
    commands: {
      emit: () => emitCommand,
      syncThrow,
      asyncReject,
      awaitThen() {
        deferredId += 1;
        return {
          command: {
            type: "resolve-commit-hash",
            requestId: `conformance:deferred:${deferredId}`,
          },
          resolve: () => undefined,
        };
      },
      cleanup: () => [{ type: "cancel-settle" }],
    },
    nonTerminalEvents: [
      { name: "idle", event: sequence({ type: "APP_HIDDEN" }) },
      {
        name: "pending",
        event: sequence({
          type: "CAPTURE_REQUESTED",
          source: "commit",
        }),
      },
      {
        name: "waitingSelectorReady",
        event: sequence(
          { type: "CAPTURE_REQUESTED", source: "commit" },
          { type: "IFRAME_LOADED" },
        ),
      },
      {
        name: "settling",
        event: sequence(
          { type: "SELECTOR_READY" },
          { type: "CAPTURE_REQUESTED", source: "commit" },
        ),
      },
      {
        name: "resolvingCommit",
        event: sequence(
          { type: "SELECTOR_READY" },
          { type: "CAPTURE_REQUESTED", source: "commit" },
          { test: "settle" },
        ),
      },
      {
        name: "awaitingResponse",
        event: sequence(
          { type: "SELECTOR_READY" },
          { type: "CAPTURE_REQUESTED", source: "commit" },
          { test: "settle" },
          { test: "commit" },
        ),
      },
      {
        name: "saving",
        event: sequence(
          { type: "SELECTOR_READY" },
          { type: "CAPTURE_REQUESTED", source: "commit" },
          { test: "settle" },
          { test: "commit" },
          { test: "response" },
        ),
      },
    ],
    stateKey: (state) =>
      JSON.stringify({
        status: state.status,
        iframeLoaded: state.iframeLoaded,
        selectorReady: state.selectorReady,
        source: "source" in state ? state.source : undefined,
        requestId: "requestId" in state ? state.requestId : undefined,
      }),
  };
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

  it("re-arms the settle lease when an iframe reloads during the settle window", async () => {
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
    const appliedEvents: ScreenshotEvent["type"][] = [];
    const controller = new ScreenshotController(7, adapter, {
      onTransitionApplied({ event }) {
        appliedEvents.push(event.type);
      },
    });

    controller.send({ type: "IFRAME_LOADED" });
    controller.send({ type: "SELECTOR_READY" });
    controller.send({ type: "CAPTURE_REQUESTED", source: "commit" });
    const firstToken = controller.getSnapshot().settleToken;
    clock.advanceBy(1_000);

    controller.send({ type: "IFRAME_LOADED" });
    const replacementToken = controller.getSnapshot().settleToken;
    expect(replacementToken).not.toBe(firstToken);
    expect(clock.pendingTimerCount()).toBe(1);

    clock.advanceBy(2_000);
    expect(controller.getSnapshot().status).toBe("waitingSelectorReady");
    clock.advanceBy(1_000);

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({
        type: "dyad-take-screenshot",
        requestId: "screenshot-capture:1",
      });
    });
    expect(appliedEvents).toContain("SETTLE_ELAPSED");
  });

  it("rejects an elapsed event from the lease replaced on iframe reload", () => {
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
    const staleToken = controller.getSnapshot().settleToken;
    controller.send({ type: "IFRAME_LOADED" });

    controller.send({
      type: "SETTLE_ELAPSED",
      requestId: "capture:stale",
      settleToken: staleToken,
    });

    expect(controller.getSnapshot().status).toBe("waitingSelectorReady");
    expect(ignored).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "stale-request" }),
    );
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
    const settleToken = controller.getSnapshot().settleToken;
    controller.send({
      type: "SETTLE_ELAPSED",
      requestId: "capture:current",
      settleToken,
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
    const errors: string[] = [];
    const runner = {
      execute: vi.fn((_appId, command) => {
        if (command.type === "schedule-settle") {
          throw new Error("clock unavailable");
        }
      }),
      disposeKey: vi.fn(),
    };
    const controller = new ScreenshotController(7, runner, undefined, (error) =>
      errors.push(error.stage),
    );

    controller.send({ type: "IFRAME_LOADED" });
    controller.send({ type: "SELECTOR_READY" });
    expect(() =>
      controller.send({ type: "CAPTURE_REQUESTED", source: "commit" }),
    ).not.toThrow();

    expect(controller.getSnapshot().status).toBe("idle");
    expect(errors).toEqual(["command"]);
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
    const settleToken = controller.getSnapshot().settleToken;
    controller.send({
      type: "SETTLE_ELAPSED",
      requestId: "capture:current",
      settleToken,
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

  it("passes the shared controller conformance suite", async () => {
    await expect(
      runControllerConformanceSuite(createScreenshotConformanceAdapter()),
    ).resolves.toBeUndefined();
  });
});

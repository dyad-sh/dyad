import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  assertAllCommandsProducible,
  assertAllStatesReachable,
  commandsOf,
  driveTransitionMatrix,
  ignoreReasonOf,
} from "@/state_machines/testing";
import {
  INITIAL_SCREENSHOT_STATE,
  type ScreenshotEvent,
  type ScreenshotCommand,
  type ScreenshotState,
} from "./state";
import { transition } from "./transition";

const READY = {
  fallbackChecked: true,
  iframeLoaded: true,
  selectorReady: true,
  queuedSource: null,
} as const;

const STATES: readonly ScreenshotState[] = [
  INITIAL_SCREENSHOT_STATE,
  { ...READY, status: "pending", source: "commit" },
  {
    ...READY,
    selectorReady: false,
    status: "waitingSelectorReady",
    source: "stream",
  },
  { ...READY, status: "settling", source: "commit" },
  {
    ...READY,
    status: "resolvingCommit",
    source: "stream",
    requestId: "capture:1",
  },
  {
    ...READY,
    status: "awaitingResponse",
    source: "commit",
    requestId: "capture:1",
    commitHash: "abc123",
  },
  {
    ...READY,
    status: "saving",
    source: "fallback",
    commitHash: "abc123",
    dataUrl: "data:image/png;base64,abc",
  },
];

const EVENTS: readonly ScreenshotEvent[] = [
  { type: "CAPTURE_REQUESTED", source: "commit" },
  { type: "CAPTURE_REQUESTED", source: "stream" },
  { type: "SELECTOR_READY" },
  { type: "IFRAME_LOADED" },
  { type: "SETTLE_ELAPSED", requestId: "capture:1" },
  { type: "COMMIT_RESOLVED", hash: "abc123", requestId: "capture:1" },
  {
    type: "RESPONSE",
    requestId: "capture:1",
    ok: true,
    dataUrl: "data:image/png;base64,abc",
  },
  {
    type: "RESPONSE",
    requestId: "stale",
    ok: true,
    dataUrl: "data:image/png;base64,stale",
  },
  { type: "APP_HIDDEN" },
  { type: "SAVED" },
  { type: "SAVE_FAILED" },
];
const STATE_KINDS = [
  "idle",
  "pending",
  "waitingSelectorReady",
  "settling",
  "resolvingCommit",
  "awaitingResponse",
  "saving",
] as const satisfies readonly ScreenshotState["status"][];
const COMMAND_KINDS = [
  "schedule-settle",
  "cancel-settle",
  "resolve-commit-hash",
  "post-capture-request",
  "save-screenshot",
  "check-existing-screenshots",
] as const satisfies readonly ScreenshotCommand["type"][];

describe("screenshot transition", () => {
  it("reaches every state and produces every command kind", () => {
    const options = {
      initialState: INITIAL_SCREENSHOT_STATE,
      events: (state: ScreenshotState) =>
        EVENTS.filter(
          (event) =>
            event.type !== "APP_HIDDEN" ||
            state.iframeLoaded ||
            state.selectorReady,
        ),
      transition,
      stateKey: JSON.stringify,
      maxStates: 5_000,
    };
    assertAllStatesReachable({
      ...options,
      inventory: STATE_KINDS,
      stateKind: (state) => state.status,
    });
    assertAllCommandsProducible({
      ...options,
      inventory: COMMAND_KINDS,
      commandKind: (command) => command.type,
    });
  });
  it("is total and reference-stable across every state and event type", () => {
    const results = driveTransitionMatrix({
      states: STATES,
      events: EVENTS,
      transition,
    });
    expect(results).toHaveLength(STATES.length * EVENTS.length);

    for (const state of STATES) {
      for (const event of EVENTS) {
        const result = transition(state, event);
        if (JSON.stringify(state) === JSON.stringify(result.state)) {
          expect(
            result.state,
            `${state.status} × ${event.type} returned a value-equal snapshot`,
          ).toBe(state);
        }
        assertReferenceStability(
          state,
          result,
          (left, right) => JSON.stringify(left) === JSON.stringify(right),
        );
      }
    }
  });

  it("ignores a stale response with the observable stale-request reason", () => {
    const awaiting = STATES[5] as Extract<
      ScreenshotState,
      { status: "awaitingResponse" }
    >;
    const stale = transition(awaiting, {
      type: "RESPONSE",
      requestId: "capture:older",
      ok: true,
      dataUrl: "data:image/png;base64,old",
    });
    expect(stale.state).toBe(awaiting);
    expect(ignoreReasonOf(stale)).toBe("stale-request");
  });

  it("keeps only the latest request while a capture is in flight", () => {
    const awaiting = STATES[5] as Extract<
      ScreenshotState,
      { status: "awaitingResponse" }
    >;
    const stream = transition(awaiting, {
      type: "CAPTURE_REQUESTED",
      source: "stream",
    });
    const commit = transition(stream.state, {
      type: "CAPTURE_REQUESTED",
      source: "commit",
    });
    expect(commit.state.queuedSource).toBe("commit");

    const saved = transition(
      {
        ...awaiting,
        status: "saving",
        dataUrl: "data:image/png;base64,current",
        queuedSource: "commit",
      },
      { type: "SAVED" },
    );
    expect(saved.state).toMatchObject({
      status: "settling",
      source: "commit",
      queuedSource: null,
    });
  });

  it("preserves pending work while hidden and resumes when the iframe returns", () => {
    const settling = STATES[3];
    const hidden = transition(settling, { type: "APP_HIDDEN" });
    expect(hidden.state).toMatchObject({
      status: "pending",
      source: "commit",
      iframeLoaded: false,
      selectorReady: false,
    });
    expect(commandsOf(hidden)).toEqual([{ type: "cancel-settle" }]);

    const loaded = transition(hidden.state, { type: "IFRAME_LOADED" });
    expect(commandsOf(loaded)).toEqual([{ type: "schedule-settle" }]);
    const ready = transition(loaded.state, { type: "SELECTOR_READY" });
    expect(ready.state.status).toBe("settling");
    expect(commandsOf(ready)).toEqual([]);

    const resolving = transition(ready.state, {
      type: "SETTLE_ELAPSED",
      requestId: "capture:resumed",
    });
    const awaiting = transition(resolving.state, {
      type: "COMMIT_RESOLVED",
      hash: "abc123",
      requestId: "capture:resumed",
    });
    const saving = transition(awaiting.state, {
      type: "RESPONSE",
      requestId: "capture:resumed",
      ok: true,
      dataUrl: "data:image/png;base64,resumed",
    });
    const saved = transition(saving.state, { type: "SAVED" });
    expect(saved.state.status).toBe("idle");
  });

  it("captures after the settle window when the iframe has no tagged selector", () => {
    const pending = transition(INITIAL_SCREENSHOT_STATE, {
      type: "CAPTURE_REQUESTED",
      source: "commit",
    });
    const loaded = transition(pending.state, { type: "IFRAME_LOADED" });
    expect(loaded.state.status).toBe("waitingSelectorReady");
    expect(commandsOf(loaded)).toEqual([{ type: "schedule-settle" }]);

    const elapsed = transition(loaded.state, {
      type: "SETTLE_ELAPSED",
      requestId: "capture:untagged",
    });
    expect(elapsed.state).toMatchObject({
      status: "resolvingCommit",
      requestId: "capture:untagged",
    });
    expect(commandsOf(elapsed)).toEqual([
      {
        type: "resolve-commit-hash",
        requestId: "capture:untagged",
      },
    ]);
  });

  it("rejects an elapsed event from a replaced settle lease", () => {
    const waiting: ScreenshotState = {
      ...READY,
      selectorReady: false,
      status: "waitingSelectorReady",
      source: "commit",
      settleToken: "settle:current",
    };

    const stale = transition(waiting, {
      type: "SETTLE_ELAPSED",
      requestId: "capture:stale",
      settleToken: "settle:replaced",
    });

    expect(stale.state).toBe(waiting);
    expect(ignoreReasonOf(stale)).toBe("stale-request");
  });

  it.each([
    ["settling", STATES[3]],
    ["resolving commit", STATES[4]],
    ["awaiting response", STATES[5]],
  ] as const)(
    "restarts the settle window when the iframe reloads while %s",
    (_description, active) => {
      const reloaded = transition(active, { type: "IFRAME_LOADED" });
      expect(reloaded.state).toMatchObject({
        status: "waitingSelectorReady",
        iframeLoaded: true,
        selectorReady: false,
      });
      expect(commandsOf(reloaded)).toEqual([{ type: "schedule-settle" }]);

      const elapsed = transition(reloaded.state, {
        type: "SETTLE_ELAPSED",
        requestId: "capture:reloaded",
      });
      expect(elapsed.state).toMatchObject({
        status: "resolvingCommit",
        requestId: "capture:reloaded",
      });
    },
  );

  it("ignores commit resolution from a superseded attempt", () => {
    const settling = STATES[3];
    const first = transition(settling, {
      type: "SETTLE_ELAPSED",
      requestId: "capture:first",
    });
    const hidden = transition(first.state, { type: "APP_HIDDEN" });
    const loaded = transition(hidden.state, { type: "IFRAME_LOADED" });
    const ready = transition(loaded.state, { type: "SELECTOR_READY" });
    const second = transition(ready.state, {
      type: "SETTLE_ELAPSED",
      requestId: "capture:second",
    });

    const staleSuccess = transition(second.state, {
      type: "COMMIT_RESOLVED",
      hash: "stale",
      requestId: "capture:first",
    });
    expect(staleSuccess.state).toBe(second.state);
    expect(ignoreReasonOf(staleSuccess)).toBe("stale-request");

    const staleFailure = transition(second.state, {
      type: "SAVE_FAILED",
      requestId: "capture:first",
    });
    expect(staleFailure.state).toBe(second.state);
    expect(ignoreReasonOf(staleFailure)).toBe("stale-request");
  });

  it("runs the fallback screenshot probe only once per app controller", () => {
    const first = transition(INITIAL_SCREENSHOT_STATE, {
      type: "SELECTOR_READY",
    });
    expect(commandsOf(first)).toEqual([{ type: "check-existing-screenshots" }]);
    expect(first.state.fallbackChecked).toBe(true);

    const reloaded = transition(first.state, { type: "IFRAME_LOADED" });
    const second = transition(reloaded.state, { type: "SELECTOR_READY" });
    expect(commandsOf(second)).toEqual([]);
    expect(second.state.fallbackChecked).toBe(true);
  });
});

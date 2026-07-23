import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  driveTransitionMatrix,
} from "@/state_machines/testing";
import {
  INITIAL_SCREENSHOT_STATE,
  type ScreenshotEvent,
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

describe("screenshot transition", () => {
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
    expect(stale.ignoredReason).toBe("stale-request");
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
    expect(hidden.commands).toEqual([{ type: "cancel-settle" }]);

    const loaded = transition(hidden.state, { type: "IFRAME_LOADED" });
    expect(loaded.commands).toEqual([{ type: "schedule-settle" }]);
    const ready = transition(loaded.state, { type: "SELECTOR_READY" });
    expect(ready.state.status).toBe("settling");
    expect(ready.commands).toEqual([]);

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
    expect(loaded.commands).toEqual([{ type: "schedule-settle" }]);

    const elapsed = transition(loaded.state, {
      type: "SETTLE_ELAPSED",
      requestId: "capture:untagged",
    });
    expect(elapsed.state).toMatchObject({
      status: "resolvingCommit",
      requestId: "capture:untagged",
    });
    expect(elapsed.commands).toEqual([
      {
        type: "resolve-commit-hash",
        requestId: "capture:untagged",
      },
    ]);
  });

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
    expect(staleSuccess.ignoredReason).toBe("stale-request");

    const staleFailure = transition(second.state, {
      type: "SAVE_FAILED",
      requestId: "capture:first",
    });
    expect(staleFailure.state).toBe(second.state);
    expect(staleFailure.ignoredReason).toBe("stale-request");
  });

  it("runs the fallback screenshot probe only once per app controller", () => {
    const first = transition(INITIAL_SCREENSHOT_STATE, {
      type: "SELECTOR_READY",
    });
    expect(first.commands).toEqual([{ type: "check-existing-screenshots" }]);
    expect(first.state.fallbackChecked).toBe(true);

    const reloaded = transition(first.state, { type: "IFRAME_LOADED" });
    const second = transition(reloaded.state, { type: "SELECTOR_READY" });
    expect(second.commands).toEqual([]);
    expect(second.state.fallbackChecked).toBe(true);
  });
});

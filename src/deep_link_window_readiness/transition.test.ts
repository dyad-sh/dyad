import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  commandsOf,
  driveTransitionMatrix,
  ignoreReasonOf,
} from "@/state_machines/testing";
import type {
  DeepLinkWindowReadinessEvent,
  DeepLinkWindowReadinessState,
} from "./state";
import { transition } from "./transition";

const firstWindow = 1;
const secondWindow = 2;

const states: DeepLinkWindowReadinessState[] = [
  { target: null, readyWindows: [] },
  { target: firstWindow, readyWindows: [] },
  { target: firstWindow, readyWindows: [firstWindow] },
  { target: secondWindow, readyWindows: [firstWindow, secondWindow] },
];

const events: DeepLinkWindowReadinessEvent[] = [
  { type: "TARGET_CHANGED", target: null },
  { type: "TARGET_CHANGED", target: firstWindow },
  { type: "TARGET_CHANGED", target: secondWindow },
  { type: "WINDOW_READY", window: firstWindow },
  { type: "WINDOW_READY", window: secondWindow },
  { type: "WINDOW_NOT_READY", window: firstWindow },
  { type: "WINDOW_NOT_READY", window: secondWindow },
];

describe("deep-link window readiness transition", () => {
  it("is total across target and readiness states", () => {
    const results = driveTransitionMatrix({ states, events, transition });
    expect(results).toHaveLength(states.length * events.length);

    let index = 0;
    for (const state of states) {
      for (const _event of events) {
        assertReferenceStability(
          state,
          results[index++],
          (left, right) =>
            left.target === right.target &&
            left.readyWindows.length === right.readyWindows.length &&
            left.readyWindows.every(
              (window, windowIndex) =>
                window === right.readyWindows[windowIndex],
            ),
        );
      }
    }
  });

  it("marks a ready replacement target available immediately", () => {
    const state = {
      target: firstWindow,
      readyWindows: [firstWindow, secondWindow],
    };

    expect(
      commandsOf(
        transition(state, {
          type: "TARGET_CHANGED",
          target: secondWindow,
        }),
      ),
    ).toEqual([{ type: "MarkQueueReady" }]);
  });

  it("deliberately ignores duplicate readiness events", () => {
    const state = {
      target: firstWindow,
      readyWindows: [firstWindow],
    };

    expect(
      ignoreReasonOf(
        transition(state, { type: "WINDOW_READY", window: firstWindow }),
      ),
    ).toBe("window-already-ready");
  });
});

import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  driveTransitionMatrix,
} from "@/state_machines/testing";
import type {
  ImageGenerationEvent,
  ImageGenerationJobDetails,
  ImageGenerationState,
} from "./state";
import { transition } from "./transition";

const job: ImageGenerationJobDetails = {
  id: "job:1",
  prompt: "A lighthouse",
  themeMode: "plain",
  targetAppId: 1,
  targetAppName: "App",
  startedAt: 100,
};
const result = {
  fileName: "generated.png",
  filePath: "/tmp/generated.png",
  appPath: "app",
  appId: 1,
  appName: "App",
};

const states: ImageGenerationState[] = [
  { type: "pending", job },
  { type: "cancelling", job },
  { type: "succeeded", job, result, lateAfterCancel: false },
  { type: "failed", job, message: "failed" },
  { type: "cancelled", job },
];
const events: ImageGenerationEvent[] = [
  { type: "JOB_SUCCEEDED", result },
  { type: "JOB_FAILED", message: "cancelled", kind: "user_cancelled" },
  { type: "JOB_FAILED", message: "failed", kind: "other" },
  { type: "CANCEL_REQUESTED" },
  { type: "CANCEL_CONFIRMED", cancelled: true },
  { type: "CANCEL_CONFIRMED", cancelled: false },
];

describe("image-generation transition", () => {
  it("is total across every state and event kind", () => {
    const results = driveTransitionMatrix({ states, events, transition });
    expect(results).toHaveLength(states.length * events.length);

    let index = 0;
    for (const state of states) {
      for (const _event of events) {
        assertReferenceStability(
          state,
          results[index++],
          (left, right) => JSON.stringify(left) === JSON.stringify(right),
        );
      }
    }
  });

  it("records late success after cancellation and invalidates media", () => {
    const state: ImageGenerationState = { type: "cancelling", job };
    const next = transition(state, { type: "JOB_SUCCEEDED", result });

    expect(next.ignoredReason).toBeUndefined();
    expect(next.state).toEqual({
      type: "succeeded",
      job,
      result,
      lateAfterCancel: true,
    });
    expect(next.commands).toEqual([{ type: "InvalidateMediaQueries" }]);
  });

  it("waits for the generation result after cancellation bookkeeping settles", () => {
    const state: ImageGenerationState = { type: "cancelling", job };
    const confirmation = transition(state, {
      type: "CANCEL_CONFIRMED",
      cancelled: false,
    });
    expect(confirmation.state).toBe(state);
    expect(confirmation.ignoredReason).toBeUndefined();

    const cancelled = transition(state, {
      type: "JOB_FAILED",
      message: "cancelled",
      kind: "user_cancelled",
    });
    expect(cancelled.state.type).toBe("cancelled");
  });
});

import { describe, expect, it } from "vitest";
import { transition } from "./transition";
import {
  EMPTY_TEST_RUN_QUEUE,
  selectCapabilities,
  type TestRunQueueEvent,
  type TestRunQueueState,
} from "./state";

const first = { runId: 1, source: "agent" as const };
const second = { runId: 2, source: "panel" as const };
const states: TestRunQueueState[] = [
  EMPTY_TEST_RUN_QUEUE,
  { activeRun: { ...first, stopping: false }, queuedRuns: [] },
  { activeRun: { ...first, stopping: false }, queuedRuns: [second] },
  { activeRun: { ...first, stopping: true }, queuedRuns: [] },
  { activeRun: { ...first, stopping: true }, queuedRuns: [second] },
];
const events: TestRunQueueEvent[] = [
  { type: "enqueue", request: first },
  { type: "enqueue", request: second },
  { type: "enqueue", request: { ...first, runId: 3 } },
  { type: "cancel", runId: 1 },
  { type: "cancel", runId: 2 },
  { type: "cancel", runId: 3 },
  { type: "settled", runId: 1 },
  { type: "settled", runId: 2 },
  { type: "stop" },
];

describe("test run queue transitions", () => {
  it("is total across idle, active, stopping, and queued states without mutating snapshots", () => {
    for (const state of states) {
      for (const event of events) {
        const before = JSON.stringify(state);
        const result = transition(state, event);
        expect(JSON.stringify(state)).toBe(before);
        if (result.kind === "ignored") expect(result.state).toBe(state);
        else expect(result.state).not.toEqual(state);
        if (!result.state.activeRun)
          expect(result.state.queuedRuns).toEqual([]);
      }
    }
  });
  it("keeps a stopped run active until its matching settlement, then starts the next request", () => {
    const stopped = transition(states[2], { type: "cancel", runId: 1 });
    expect(stopped.state.activeRun).toEqual({ ...first, stopping: true });
    expect(transition(stopped.state, { type: "settled", runId: 2 }).state).toBe(
      stopped.state,
    );
    expect(
      transition(stopped.state, { type: "settled", runId: 1 }),
    ).toMatchObject({
      state: { activeRun: { ...second, stopping: false }, queuedRuns: [] },
      commands: [{ type: "execute", runId: 2 }],
    });
  });
  it("offers Stop exactly while requests are admitted", () => {
    for (const state of states) {
      expect(selectCapabilities(state).canStop).toBe(state.activeRun !== null);
      const result = transition(state, { type: "stop" });
      if (selectCapabilities(state).canStop)
        expect(result.state.queuedRuns).toEqual([]);
      else expect(result.kind).toBe("ignored");
    }
  });
});

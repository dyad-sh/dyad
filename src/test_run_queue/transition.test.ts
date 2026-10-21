import { describe, expect, it } from "vitest";
import { transition } from "./transition";
import {
  EMPTY_TEST_RUN_QUEUE,
  selectCapabilities,
  type TestRunQueueEvent,
  type TestRunQueueState,
} from "./state";

const first = { runId: 1, source: "agent" as const };
const panelStop = { kind: "tests-panel-stop" as const };
const chatStop = { kind: "chat-stop" as const };
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
  { type: "cancel", runId: 1, reason: chatStop },
  { type: "cancel", runId: 2, reason: chatStop },
  { type: "cancel", runId: 3, reason: chatStop },
  { type: "settled", runId: 1 },
  { type: "settled", runId: 2 },
  { type: "stop", reason: panelStop },
];

describe("test run queue transitions", () => {
  it("starts idle requests and preserves FIFO ordering without executing queued work", () => {
    const started = transition(EMPTY_TEST_RUN_QUEUE, {
      type: "enqueue",
      request: first,
    });
    expect(started).toMatchObject({
      kind: "applied",
      state: { activeRun: { ...first, stopping: false }, queuedRuns: [] },
      commands: [{ type: "execute", runId: 1 }],
    });
    const queued = transition(started.state, {
      type: "enqueue",
      request: second,
    });
    expect(queued).toMatchObject({
      kind: "applied",
      state: { queuedRuns: [second] },
      commands: [],
    });
    const third = { ...first, runId: 3 };
    expect(
      transition(queued.state, { type: "enqueue", request: third }),
    ).toMatchObject({
      kind: "applied",
      state: { queuedRuns: [second, third] },
      commands: [],
    });
    for (const state of states) {
      for (const type of ["cancel", "settled"] as const) {
        const stale = transition(
          state,
          type === "cancel"
            ? { type, runId: 99, reason: chatStop }
            : { type, runId: 99 },
        );
        expect(stale.kind).toBe("ignored");
        expect(stale.state).toBe(state);
        expect(stale).not.toHaveProperty("commands");
      }
    }
  });
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
    const stopped = transition(states[2], {
      type: "cancel",
      runId: 1,
      reason: chatStop,
    });
    expect(stopped.state.activeRun).toEqual({
      ...first,
      stopping: true,
      stopReason: chatStop,
    });
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
  it("carries each stop's cause to the commands it emits and keeps the first cause on the active run", () => {
    expect(transition(states[2], { type: "stop", reason: panelStop })).toEqual({
      kind: "applied",
      state: {
        activeRun: { ...first, stopping: true, stopReason: panelStop },
        queuedRuns: [],
      },
      commands: [
        { type: "cancel-queued", runId: 2, reason: panelStop },
        { type: "abort", runId: 1, reason: panelStop },
      ],
    });
    expect(
      transition(states[2], { type: "cancel", runId: 2, reason: chatStop }),
    ).toMatchObject({
      kind: "applied",
      commands: [{ type: "cancel-queued", runId: 2, reason: chatStop }],
    });

    const stoppedByChat = transition(states[2], {
      type: "cancel",
      runId: 1,
      reason: chatStop,
    });
    expect(stoppedByChat).toMatchObject({
      kind: "applied",
      commands: [{ type: "abort", runId: 1, reason: chatStop }],
    });
    // A later Stop clears the queue under its own cause but cannot re-abort or
    // relabel the run that the chat already stopped.
    expect(
      transition(stoppedByChat.state, { type: "stop", reason: panelStop }),
    ).toEqual({
      kind: "applied",
      state: {
        activeRun: { ...first, stopping: true, stopReason: chatStop },
        queuedRuns: [],
      },
      commands: [{ type: "cancel-queued", runId: 2, reason: panelStop }],
    });
  });
  it("offers Stop exactly while requests are admitted", () => {
    for (const state of states) {
      // A queued-only state is unreachable: admission starts an idle queue,
      // and settlement promotes its next request atomically.
      if (state.activeRun === null) expect(state.queuedRuns).toEqual([]);
      expect(selectCapabilities(state).canStop).toBe(state.activeRun !== null);
      const result = transition(state, { type: "stop", reason: panelStop });
      if (selectCapabilities(state).canStop)
        expect(result.state.queuedRuns).toEqual([]);
      else expect(result.kind).toBe("ignored");
    }
  });
});

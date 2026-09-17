import { change, ignore, type TransitionResult } from "@/state_machines/types";
import type {
  TestRunQueueCommand,
  TestRunQueueEvent,
  TestRunQueueState,
} from "./state";

export function transition(
  state: TestRunQueueState,
  event: TestRunQueueEvent,
): TransitionResult<TestRunQueueState, TestRunQueueCommand> {
  switch (event.type) {
    case "enqueue": {
      if (
        state.activeRun?.runId === event.request.runId ||
        state.queuedRuns.some((run) => run.runId === event.request.runId)
      ) {
        return ignore(state, "duplicate-run");
      }
      return state.activeRun
        ? change({ ...state, queuedRuns: [...state.queuedRuns, event.request] })
        : change(
            {
              activeRun: { ...event.request, stopping: false },
              queuedRuns: [],
            },
            [{ type: "execute", runId: event.request.runId }],
          );
    }
    case "cancel": {
      if (state.activeRun?.runId === event.runId) {
        if (state.activeRun.stopping) return ignore(state, "already-stopping");
        return change(
          { ...state, activeRun: { ...state.activeRun, stopping: true } },
          [{ type: "abort", runId: event.runId }],
        );
      }
      if (!state.queuedRuns.some((run) => run.runId === event.runId)) {
        return ignore(state, "stale-operation");
      }
      return change(
        {
          ...state,
          queuedRuns: state.queuedRuns.filter(
            (run) => run.runId !== event.runId,
          ),
        },
        [{ type: "cancel-queued", runId: event.runId }],
      );
    }
    case "stop": {
      if (!state.activeRun) return ignore(state, "idle");
      if (state.activeRun.stopping && state.queuedRuns.length === 0) {
        return ignore(state, "already-stopping");
      }
      return change(
        { activeRun: { ...state.activeRun, stopping: true }, queuedRuns: [] },
        [
          ...state.queuedRuns.map(
            (run): TestRunQueueCommand => ({
              type: "cancel-queued",
              runId: run.runId,
            }),
          ),
          { type: "abort", runId: state.activeRun.runId },
        ],
      );
    }
    case "settled": {
      if (state.activeRun?.runId !== event.runId)
        return ignore(state, "stale-operation");
      const [next, ...remaining] = state.queuedRuns;
      return change(
        {
          activeRun: next ? { ...next, stopping: false } : null,
          queuedRuns: remaining,
        },
        next ? [{ type: "execute", runId: next.runId }] : [],
      );
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

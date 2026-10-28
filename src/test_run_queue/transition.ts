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
  if (state.activeRuns) return transitionAdmitted(state, event);
  switch (event.type) {
    case "waiting":
    case "admit":
      return ignore(state, "automatic-admission");
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
          {
            ...state,
            activeRun: {
              ...state.activeRun,
              stopping: true,
              stopReason: event.reason,
            },
          },
          [{ type: "abort", runId: event.runId, reason: event.reason }],
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
        [{ type: "cancel-queued", runId: event.runId, reason: event.reason }],
      );
    }
    case "stop": {
      if (!state.activeRun) return ignore(state, "idle");
      if (state.activeRun.stopping && state.queuedRuns.length === 0) {
        return ignore(state, "already-stopping");
      }
      const queuedCancellations = state.queuedRuns.map(
        (run): TestRunQueueCommand => ({
          type: "cancel-queued",
          runId: run.runId,
          reason: event.reason,
        }),
      );
      // A run already stopping keeps the cause that actually aborted it; this
      // Stop only clears the requests queued behind it.
      if (state.activeRun.stopping) {
        return change(
          { activeRun: state.activeRun, queuedRuns: [] },
          queuedCancellations,
        );
      }
      return change(
        {
          activeRun: {
            ...state.activeRun,
            stopping: true,
            stopReason: event.reason,
          },
          queuedRuns: [],
        },
        [
          ...queuedCancellations,
          {
            type: "abort",
            runId: state.activeRun.runId,
            reason: event.reason,
          },
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

/** Resource decisions are inputs. This transition reserves ownership before execution. */
function transitionAdmitted(
  state: TestRunQueueState,
  event: TestRunQueueEvent,
): TransitionResult<TestRunQueueState, TestRunQueueCommand> {
  const active = state.activeRuns!;
  const commit = (
    activeRuns: typeof active,
    queuedRuns = state.queuedRuns,
    commands: TestRunQueueCommand[] = [],
  ) =>
    change(
      { activeRun: activeRuns[0] ?? null, activeRuns, queuedRuns },
      commands,
    );
  switch (event.type) {
    case "enqueue":
      if (
        [...active, ...state.queuedRuns].some(
          (run) => run.runId === event.request.runId,
        )
      )
        return ignore(state, "duplicate-run");
      return commit(active, [...state.queuedRuns, event.request]);
    case "waiting": {
      const run = state.queuedRuns.find((run) => run.runId === event.runId);
      if (
        !run ||
        (run.queuedReason === event.reason && run.branch === event.branch)
      )
        return ignore(state, "unchanged-wait");
      return commit(
        active,
        state.queuedRuns.map((run) =>
          run.runId === event.runId
            ? { ...run, queuedReason: event.reason, branch: event.branch }
            : run,
        ),
      );
    }
    case "admit": {
      const run = state.queuedRuns.find((run) => run.runId === event.runId);
      if (!run) return ignore(state, "stale-operation");
      return commit(
        [...active, { ...run, queuedReason: undefined, stopping: false }],
        state.queuedRuns.filter((run) => run.runId !== event.runId),
        [{ type: "execute", runId: event.runId }],
      );
    }
    case "settled":
      if (!active.some((run) => run.runId === event.runId))
        return ignore(state, "stale-operation");
      return commit(active.filter((run) => run.runId !== event.runId));
    case "cancel": {
      const run = active.find((run) => run.runId === event.runId);
      if (run) {
        if (run.stopping) return ignore(state, "already-stopping");
        return commit(
          active.map((run) =>
            run.runId === event.runId
              ? { ...run, stopping: true, stopReason: event.reason }
              : run,
          ),
          state.queuedRuns,
          [{ type: "abort", runId: event.runId, reason: event.reason }],
        );
      }
      if (!state.queuedRuns.some((run) => run.runId === event.runId))
        return ignore(state, "stale-operation");
      return commit(
        active,
        state.queuedRuns.filter((run) => run.runId !== event.runId),
        [{ type: "cancel-queued", runId: event.runId, reason: event.reason }],
      );
    }
    case "stop": {
      const stopping = active.filter((run) => !run.stopping);
      if (!stopping.length && !state.queuedRuns.length)
        return ignore(state, "idle");
      return commit(
        active.map((run) =>
          run.stopping
            ? run
            : { ...run, stopping: true, stopReason: event.reason },
        ),
        [],
        [
          ...state.queuedRuns.map(
            (run): TestRunQueueCommand => ({
              type: "cancel-queued",
              runId: run.runId,
              reason: event.reason,
            }),
          ),
          ...stopping.map(
            (run): TestRunQueueCommand => ({
              type: "abort",
              runId: run.runId,
              reason: event.reason,
            }),
          ),
        ],
      );
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

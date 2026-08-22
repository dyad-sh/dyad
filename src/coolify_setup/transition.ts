import {
  IDLE,
  MAX_LOG_CHARS,
  type CoolifySetupCommand,
  type CoolifySetupEvent,
  type CoolifySetupRunning,
  type CoolifySetupState,
  type TransitionResult,
} from "./state";
import { sameInvocationRef } from "@/state_machines/invocation_ref";
import {
  STALE_OPERATION_IGNORE_REASON,
  change,
  ignore,
  stay,
} from "@/state_machines/types";

function appendLog(existing: string, chunk: string): string {
  const combined = existing + chunk;
  return combined.length > MAX_LOG_CHARS
    ? combined.slice(combined.length - MAX_LOG_CHARS)
    : combined;
}

/**
 * Returns the running state only when the event claims the live invocation.
 *
 * This is what stops a setup the user has left behind from writing progress,
 * a finished screen, or an error over whatever replaced it.
 */
function runningFor(
  state: CoolifySetupState,
  ref: CoolifySetupRunning["invocationRef"],
): CoolifySetupRunning | null {
  if (state.type !== "running") return null;
  return sameInvocationRef(state.invocationRef, ref) ? state : null;
}

/** Progress and completions all answer the same question about identity. */
function notForTheRunInHand(state: CoolifySetupState): TransitionResult {
  return ignore(
    state,
    state.type === "running" ? STALE_OPERATION_IGNORE_REASON : "not-running",
  );
}

/**
 * Pure transition function for the Coolify server setup machine.
 *
 * Total: every event is answered from every state, and one that does not apply
 * is ignored with a reason rather than throwing. That is the point rather than
 * a convenience — these events come from a process that does not know what the
 * user has done since, so an answer for a run that is no longer the one in
 * hand is ordinary traffic, not an error.
 */
export function coolifySetupTransition(
  state: CoolifySetupState,
  event: CoolifySetupEvent,
): TransitionResult {
  switch (event.type) {
    case "start-requested": {
      // One at a time, decided here rather than by a check beside the effect.
      // Two installs on one machine would interleave their output and fight
      // over the same docker state.
      if (state.type === "running") return ignore(state, "already-running");
      const command: CoolifySetupCommand = {
        type: "launch",
        invocationRef: event.invocationRef,
        target: event.target,
      };
      return change(
        {
          type: "running",
          host: event.target.host,
          invocationRef: event.invocationRef,
          step: "connecting",
          log: "",
          stopping: false,
        },
        [command],
      );
    }

    case "cancel-requested": {
      // Nothing to stop is not a failure; it is the ordinary answer to a
      // cancel that raced the run finishing.
      if (state.type !== "running") return ignore(state, "not-running");
      const abort: CoolifySetupCommand = {
        type: "abort",
        invocationRef: state.invocationRef,
      };
      // Already stopping: the abort is worth sending again, since aborting
      // twice is the same as aborting once — but the state is not worth
      // remaking. A value-equal snapshot with a new reference is a change
      // that changes nothing, and every window would be told about it.
      if (state.stopping) return stay(state, [abort]);
      return change({ ...state, stopping: true }, [abort]);
    }

    case "progress": {
      const running = runningFor(state, event.invocationRef);
      if (!running) return notForTheRunInHand(state);
      const log = event.output
        ? appendLog(running.log, event.output)
        : running.log;
      // Same answer as last time. Returning a new object anyway would send
      // every window a change that changes nothing.
      if (running.step === event.step && running.log === log) {
        return stay(running, []);
      }
      return change({ ...running, step: event.step, log });
    }

    case "succeeded": {
      const running = runningFor(state, event.invocationRef);
      if (!running) return notForTheRunInHand(state);
      return change({
        type: "done",
        host: running.host,
        invocationRef: running.invocationRef,
        result: event.result,
      });
    }

    case "failed": {
      const running = runningFor(state, event.invocationRef);
      if (!running) return notForTheRunInHand(state);
      return change({
        type: "failed",
        host: running.host,
        invocationRef: running.invocationRef,
        message: event.message,
        log: running.log,
        cancelled: event.cancelled,
      });
    }

    case "dismissed":
      if (state.type === "running") return ignore(state, "still-running");
      if (state.type === "idle") return ignore(state, "not-running");
      return change(IDLE);

    default: {
      // Total by construction: adding an event without answering it above
      // stops this assignment compiling.
      const unanswered: never = event;
      void unanswered;
      return ignore(state, "not-running");
    }
  }
}

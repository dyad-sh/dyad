import {
  MAX_LOG_CHARS,
  type CoolifyDeployEvent,
  type CoolifyDeployRunning,
  type CoolifyDeployState,
  type TransitionResult,
} from "./state";
import { sameInvocationRef } from "@/state_machines/invocation_ref";
import { STALE_OPERATION_IGNORE_REASON } from "@/state_machines/types";
import { change, ignore } from "@/state_machines/types";

function appendLog(existing: string, chunk: string): string {
  const combined = existing + chunk;
  return combined.length > MAX_LOG_CHARS
    ? combined.slice(combined.length - MAX_LOG_CHARS)
    : combined;
}

/** Which app a state belongs to, or null when idle. */
function stateAppId(state: CoolifyDeployState): number | null {
  return state.type === "idle" ? null : state.appId;
}

/**
 * Returns the running state only when the event claims the live invocation.
 *
 * This is what stops a cancelled or superseded deployment from writing
 * progress, a URL, or an error over whatever replaced it.
 */
function runningFor(
  state: CoolifyDeployState,
  ref: CoolifyDeployRunning["invocationRef"],
): CoolifyDeployRunning | null {
  if (state.type !== "running") return null;
  return sameInvocationRef(state.invocationRef, ref) ? state : null;
}

/**
 * Pure transition function for the per-app Coolify deployment machine.
 *
 * No side effects and no runtime imports beyond pure helpers. Ignored events
 * return the same state reference so callers can detect no-ops by identity.
 */
export function transition(
  state: CoolifyDeployState,
  event: CoolifyDeployEvent,
): TransitionResult {
  switch (event.type) {
    case "DEPLOY_REQUESTED": {
      if (state.type === "running") {
        return ignore(state, "already-running");
      }
      // A terminal state belonging to another app would otherwise hand this
      // one its deployment id below, and the retry would adopt a build that
      // was never for it. CANCELLED guards the same way.
      if (state.type !== "idle" && stateAppId(state) !== event.appId) {
        return ignore(state, "other-app");
      }
      return change(
        {
          type: "running",
          appId: event.appId,
          invocationRef: event.invocationRef,
          stage: "preparing",
          log: "",
          startedAt: event.startedAt,
          deploymentUuid: null,
        },
        [
          {
            type: "RUN_DEPLOY",
            appId: event.appId,
            invocationRef: event.invocationRef,
            // A failed attempt may have left a deployment running; carry it so
            // the retry adopts it instead of starting a second build.
            resumeDeploymentUuid:
              state.type === "failed" ? state.deploymentUuid : null,
          },
        ],
      );
    }

    case "STAGE_CHANGED": {
      const running = runningFor(state, event.invocationRef);
      if (!running) return ignore(state, STALE_OPERATION_IGNORE_REASON);
      // Re-reporting the stage it is already on is a no-op, not a stale event
      // from a superseded deployment; the two are worth telling apart in a log.
      if (running.stage === event.stage) return ignore(state, "no-change");
      return change({ ...running, stage: event.stage });
    }

    case "LOG_APPENDED": {
      const running = runningFor(state, event.invocationRef);
      if (!running) return ignore(state, STALE_OPERATION_IGNORE_REASON);
      const log = appendLog(running.log, event.chunk);
      // An empty chunk would otherwise return a new snapshot identical to the
      // old one, which subscribers cannot tell from real progress.
      if (log === running.log) return ignore(state, "no-change");
      return change({ ...running, log });
    }

    case "DEPLOYMENT_STARTED": {
      const running = runningFor(state, event.invocationRef);
      if (!running) return ignore(state, STALE_OPERATION_IGNORE_REASON);
      if (running.deploymentUuid === event.deploymentUuid) {
        return ignore(state, "no-change");
      }
      return change({ ...running, deploymentUuid: event.deploymentUuid });
    }

    case "SUCCEEDED": {
      const running = runningFor(state, event.invocationRef);
      if (!running) return ignore(state, STALE_OPERATION_IGNORE_REASON);
      return change({
        type: "succeeded",
        appId: running.appId,
        log: running.log,
        url: event.url,
        finishedAt: event.finishedAt,
      });
    }

    case "FAILED": {
      const running = runningFor(state, event.invocationRef);
      if (!running) return ignore(state, STALE_OPERATION_IGNORE_REASON);
      return change({
        type: "failed",
        appId: running.appId,
        log: running.log,
        error: event.error,
        finishedAt: event.finishedAt,
        deploymentUuid: running.deploymentUuid,
      });
    }

    case "CANCELLED": {
      if (state.type === "idle") return ignore(state, "nothing-to-cancel");
      if (stateAppId(state) !== event.appId) {
        return ignore(state, "other-app");
      }
      if (state.type !== "running") {
        // A finished result still clears, so reconnecting never shows the
        // previous server's outcome.
        return change({ type: "idle" });
      }
      return change({ type: "idle" }, [
        { type: "ABORT_DEPLOY", invocationRef: state.invocationRef },
      ]);
    }

    default: {
      const exhaustive: never = event;
      return ignore(state, `unhandled:${JSON.stringify(exhaustive)}` as never);
    }
  }
}

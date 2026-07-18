import type { PreviewRunState } from "@/atoms/previewRuntimeAtoms";
import type {
  ReloadReason,
  RunCommand,
  RunEvent,
  RunState,
  TransitionResult,
} from "./state";

/**
 * Pure transition function for the per-app run-state machine.
 *
 * No side effects, no non-type imports: given the current state and an
 * event, returns the next state plus the commands the adapter should run.
 * Ignored events return the SAME state reference so callers can detect
 * no-ops by identity.
 *
 * Stale-runId filtering happens in two layers: the controller drops events
 * whose runId doesn't match the current epoch before they get here, and
 * this function independently ignores completion events whose runId doesn't
 * match the state's runId (defense in depth — a stale runId must never
 * advance the state).
 */
export function transition(state: RunState, event: RunEvent): TransitionResult {
  switch (event.type) {
    case "START":
      return {
        state: {
          type: "starting",
          appId: event.appId,
          runId: event.runId,
          operation: "run",
          startedAt: event.startedAt,
          pendingUrl: null,
        },
        commands: [
          {
            type: "start",
            appId: event.appId,
            runId: event.runId,
            operation: "run",
            startedAt: event.startedAt,
            options: { removeNodeModules: false, recreateSandbox: false },
          },
        ],
      };

    case "RESTART":
      return {
        state: {
          type: "starting",
          appId: event.appId,
          runId: event.runId,
          operation: "restart",
          startedAt: event.startedAt,
          pendingUrl: null,
        },
        commands: [
          {
            type: "start",
            appId: event.appId,
            runId: event.runId,
            operation: "restart",
            startedAt: event.startedAt,
            options: event.options,
          },
        ],
      };

    case "REBUILD":
      return {
        state: {
          type: "starting",
          appId: event.appId,
          runId: event.runId,
          operation: "rebuild",
          startedAt: event.startedAt,
          pendingUrl: null,
        },
        commands: [
          {
            type: "start",
            appId: event.appId,
            runId: event.runId,
            operation: "rebuild",
            startedAt: event.startedAt,
            options: { removeNodeModules: true, recreateSandbox: false },
          },
        ],
      };

    case "STOP":
      return {
        state: {
          type: "stopping",
          appId: event.appId,
          runId: event.runId,
          startedAt: event.startedAt,
        },
        commands: [{ type: "stop", appId: event.appId, runId: event.runId }],
      };

    case "RUN_IPC_RESOLVED": {
      if (state.type !== "starting" || state.runId !== event.runId) {
        return ignore(state);
      }
      const commands: RunCommand[] = [
        { type: "clearError", appId: state.appId },
      ];
      if (state.pendingUrl) {
        // applyUrl bumps the reload token, which also covers the
        // restart/rebuild "always reload on settle" behavior.
        commands.push({
          type: "applyUrl",
          appId: state.appId,
          url: state.pendingUrl,
        });
      } else if (state.operation !== "run") {
        commands.push({ type: "bumpReloadToken", appId: state.appId });
      }
      return {
        state: {
          type: "ready",
          appId: state.appId,
          runId: state.runId,
          url: state.pendingUrl,
        },
        commands,
      };
    }

    case "RUN_IPC_FAILED": {
      if (state.type !== "starting" || state.runId !== event.runId) {
        return ignore(state);
      }
      if (state.pendingUrl) {
        // The dev server verifiably reported ready (buffered proxy line)
        // even though the run/restart IPC failed — e.g. a cloud restart
        // where a step after proxy setup errored. Matching the pre-machine
        // behavior (which had already applied the proxy line by this
        // point): surface the error AND show the served app, rather than
        // blanking a preview that is actually working.
        return {
          state: {
            type: "ready",
            appId: state.appId,
            runId: state.runId,
            url: state.pendingUrl,
          },
          commands: [
            { type: "setError", appId: state.appId, error: event.error },
            { type: "applyUrl", appId: state.appId, url: state.pendingUrl },
          ],
        };
      }
      const commands: RunCommand[] = [
        { type: "setError", appId: state.appId, error: event.error },
      ];
      if (state.operation !== "run") {
        // Restart/rebuild always reload the iframe when the IPC settles,
        // success or failure (previously the `finally` block).
        commands.push({ type: "bumpReloadToken", appId: state.appId });
      }
      return {
        state: {
          type: "errored",
          appId: state.appId,
          runId: state.runId,
          error: event.error,
        },
        commands,
      };
    }

    case "STOP_IPC_RESOLVED":
      if (state.type !== "stopping" || state.runId !== event.runId) {
        return ignore(state);
      }
      return {
        state: {
          type: "stopped",
          appId: state.appId,
          runId: state.runId,
          exitCode: null,
        },
        commands: [{ type: "clearError", appId: state.appId }],
      };

    case "STOP_IPC_FAILED":
      if (state.type !== "stopping" || state.runId !== event.runId) {
        return ignore(state);
      }
      return {
        state: {
          type: "errored",
          appId: state.appId,
          runId: state.runId,
          error: event.error,
        },
        commands: [
          { type: "setError", appId: state.appId, error: event.error },
        ],
      };

    case "PROXY_READY":
      switch (state.type) {
        case "starting":
          // Buffer: never let a proxy line (possibly a re-emitted cached
          // one from before this operation) clear a fresh operation's
          // loading state or show a stale URL mid-operation. Applied when
          // the run IPC resolves. Last line wins.
          return {
            state: { ...state, pendingUrl: event.url },
            commands: [],
          };
        case "ready":
          return {
            state: { ...state, url: event.url },
            commands: [
              { type: "applyUrl", appId: state.appId, url: event.url },
            ],
          };
        case "reloading":
          return {
            state: { ...state, url: event.url },
            commands: [
              { type: "applyUrl", appId: state.appId, url: event.url },
            ],
          };
        case "stopping":
          // A proxy line while stopping is stale by construction; applying
          // it would stomp the stop operation's state.
          return ignore(state);
        case "idle":
        case "stopped":
        case "errored":
          // No run in flight: the backend re-emits the cached proxy line
          // for already-running apps (e.g. after switching back to an app).
          // Re-establish `ready` with the URL, matching prior behavior.
          return {
            state: {
              type: "ready",
              appId: event.appId,
              runId: event.runId,
              url: event.url,
            },
            commands: [
              { type: "applyUrl", appId: event.appId, url: event.url },
            ],
          };
        default:
          return assertNever(state);
      }

    case "HMR_DETECTED":
    case "MANUAL_RELOAD": {
      const reason: ReloadReason =
        event.type === "HMR_DETECTED" ? "hmr" : "manual";
      if (state.type === "ready") {
        return {
          state: {
            type: "reloading",
            appId: state.appId,
            runId: state.runId,
            reason,
            url: state.url,
          },
          commands: [
            {
              type: "reload",
              appId: state.appId,
              runId: state.runId,
              reason,
            },
          ],
        };
      }
      // Outside `ready`, preserve the historical unconditional reload-token
      // bump without changing run state.
      return {
        state,
        commands: [{ type: "bumpReloadToken", appId: event.appId }],
      };
    }

    case "RELOAD_DONE":
      if (state.type !== "reloading" || state.runId !== event.runId) {
        return ignore(state);
      }
      return {
        state: {
          type: "ready",
          appId: state.appId,
          runId: state.runId,
          url: state.url,
        },
        commands: [],
      };

    case "APP_EXIT":
      if (state.type === "ready" || state.type === "reloading") {
        return {
          state: {
            type: "stopped",
            appId: state.appId,
            runId: state.runId,
            exitCode: event.exitCode,
          },
          commands: [],
        };
      }
      // During starting/stopping the IPC settlement drives the state (as
      // before); in idle/stopped/errored there is nothing to do. The exit
      // details atom is written by the output subscription either way.
      return ignore(state);

    default:
      return assertNever(event);
  }
}

/** Explicitly ignore an event: same state reference, no commands. */
export function ignore(state: RunState): TransitionResult {
  return { state, commands: [] };
}

/**
 * Projection of the machine state onto the legacy `PreviewRunState` shape
 * stored in `previewRunStateByAppIdAtom`. `undefined` means "not loading",
 * exactly as before: the atom entry only exists while a run/restart/stop
 * operation is in flight.
 */
export function projectRunState(state: RunState): PreviewRunState | undefined {
  switch (state.type) {
    case "starting":
      return {
        operation: state.operation === "run" ? "run" : "restart",
        startedAt: state.startedAt,
      };
    case "stopping":
      return { operation: "stop", startedAt: state.startedAt };
    case "idle":
    case "ready":
    case "reloading":
    case "stopped":
    case "errored":
      return undefined;
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

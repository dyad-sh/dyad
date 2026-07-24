import type { PreviewRunState } from "@/atoms/previewRuntimeAtoms";
import type {
  ReloadReason,
  RunCommand,
  RunEvent,
  RunState,
  RunUrl,
  TransitionResult,
} from "./state";
import { sameInvocationRef } from "@/state_machines/invocation_ref";
import { ignore as ignoreTransition } from "@/state_machines/types";

function sameRunUrl(left: RunUrl | null, right: RunUrl): boolean {
  return (
    left !== null &&
    left.appUrl === right.appUrl &&
    left.originalUrl === right.originalUrl &&
    left.mode === right.mode
  );
}

/**
 * Pure transition function for the per-app run-state machine.
 *
 * No side effects, no non-type imports: given the current state and an
 * event, returns the next state plus the commands the adapter should run.
 * Ignored events return the SAME state reference so callers can detect
 * no-ops by identity.
 *
 * Stale-operation filtering happens in two layers: the controller rejects
 * producer/completion events that do not claim the active invocation, and
 * this function independently matches refs as defense in depth.
 */
export function transition(state: RunState, event: RunEvent): TransitionResult {
  switch (event.type) {
    case "START":
      return {
        kind: "applied",
        state: {
          type: "starting",
          appId: event.appId,
          invocationRef: event.invocationRef,
          operation: "run",
          startedAt: event.startedAt,
          pendingUrl: null,
        },
        commands: [
          {
            type: "start",
            appId: event.appId,
            invocationRef: event.invocationRef,
            operation: "run",
            startedAt: event.startedAt,
            options: { removeNodeModules: false, recreateSandbox: false },
          },
        ],
      };

    case "RESTART":
      return {
        kind: "applied",
        state: {
          type: "starting",
          appId: event.appId,
          invocationRef: event.invocationRef,
          operation: "restart",
          startedAt: event.startedAt,
          pendingUrl: null,
        },
        commands: [
          {
            type: "start",
            appId: event.appId,
            invocationRef: event.invocationRef,
            operation: "restart",
            startedAt: event.startedAt,
            options: event.options,
          },
        ],
      };

    case "REBUILD":
      return {
        kind: "applied",
        state: {
          type: "starting",
          appId: event.appId,
          invocationRef: event.invocationRef,
          operation: "rebuild",
          startedAt: event.startedAt,
          pendingUrl: null,
        },
        commands: [
          {
            type: "start",
            appId: event.appId,
            invocationRef: event.invocationRef,
            operation: "rebuild",
            startedAt: event.startedAt,
            options: { removeNodeModules: true, recreateSandbox: false },
          },
        ],
      };

    case "EXTERNAL_RESTART":
      return {
        kind: "applied",
        state: {
          type: "starting",
          appId: event.appId,
          invocationRef: event.invocationRef,
          operation: event.operation,
          startedAt: event.startedAt,
          pendingUrl: null,
        },
        commands: [
          {
            type: "prepareExternalStart",
            appId: event.appId,
            operation: event.operation,
          },
        ],
      };

    case "STOP":
      return {
        kind: "applied",
        state: {
          type: "stopping",
          appId: event.appId,
          invocationRef: event.invocationRef,
          startedAt: event.startedAt,
        },
        commands: [
          {
            type: "stop",
            appId: event.appId,
            invocationRef: event.invocationRef,
          },
        ],
      };

    case "RUN_IPC_RESOLVED": {
      if (
        state.type !== "starting" ||
        !sameInvocationRef(state.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-operation");
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
        kind: "applied",
        state: {
          type: "ready",
          appId: state.appId,
          invocationRef: state.invocationRef,
          url: state.pendingUrl,
        },
        commands,
      };
    }

    case "RUN_IPC_FAILED": {
      if (
        state.type !== "starting" ||
        !sameInvocationRef(state.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-operation");
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
        kind: "applied",
        state: {
          type: "errored",
          appId: state.appId,
          invocationRef: state.invocationRef,
          error: event.error,
        },
        commands,
      };
    }

    case "STOP_IPC_RESOLVED":
      if (
        state.type !== "stopping" ||
        !sameInvocationRef(state.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-operation");
      }
      return {
        kind: "applied",
        state: {
          type: "stopped",
          appId: state.appId,
          invocationRef: state.invocationRef,
          exitCode: null,
        },
        commands: [{ type: "clearError", appId: state.appId }],
      };

    case "STOP_IPC_FAILED":
      if (
        state.type !== "stopping" ||
        !sameInvocationRef(state.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-operation");
      }
      return {
        kind: "applied",
        state: {
          type: "errored",
          appId: state.appId,
          invocationRef: state.invocationRef,
          error: event.error,
        },
        commands: [
          { type: "setError", appId: state.appId, error: event.error },
        ],
      };

    case "PROXY_READY":
      if (
        state.type !== "idle" &&
        !sameInvocationRef(state.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-operation");
      }
      switch (state.type) {
        case "starting":
          // Buffer: never let a proxy line (possibly a re-emitted cached
          // one from before this operation) clear a fresh operation's
          // loading state or show a stale URL mid-operation. Applied when
          // the run IPC resolves. Last line wins.
          if (sameRunUrl(state.pendingUrl, event.url)) {
            return ignore(state, "no-change");
          }
          return {
            kind: "applied",
            state: { ...state, pendingUrl: event.url },
            commands: [],
          };
        case "ready":
          return {
            kind: "applied",
            state: sameRunUrl(state.url, event.url)
              ? state
              : { ...state, url: event.url },
            commands: [
              { type: "applyUrl", appId: state.appId, url: event.url },
            ],
          };
        case "reloading":
          return {
            kind: "applied",
            state: sameRunUrl(state.url, event.url)
              ? state
              : { ...state, url: event.url },
            commands: [
              { type: "applyUrl", appId: state.appId, url: event.url },
            ],
          };
        case "stopping":
          // A proxy line while stopping is stale by construction; applying
          // it would stomp the stop operation's state.
          return ignore(state, "stale-operation");
        case "idle":
        case "stopped":
        case "errored":
          // No run in flight: the backend re-emits the cached proxy line
          // for already-running apps (e.g. after switching back to an app).
          // Re-establish `ready` with the URL, matching prior behavior.
          return {
            kind: "applied",
            state: {
              type: "ready",
              appId: event.appId,
              invocationRef: event.invocationRef,
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
          kind: "applied",
          state: {
            type: "reloading",
            appId: state.appId,
            invocationRef: state.invocationRef,
            reason,
            url: state.url,
          },
          commands: [
            {
              type: "reload",
              appId: state.appId,
              invocationRef: state.invocationRef,
              reason,
            },
          ],
        };
      }
      // Outside `ready`, preserve the historical unconditional reload-token
      // bump without changing run state.
      return {
        kind: "applied",
        state,
        commands: [{ type: "bumpReloadToken", appId: event.appId }],
      };
    }

    case "RELOAD_DONE":
      if (
        state.type !== "reloading" ||
        !sameInvocationRef(state.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-operation");
      }
      return {
        kind: "applied",
        state: {
          type: "ready",
          appId: state.appId,
          invocationRef: state.invocationRef,
          url: state.url,
        },
        commands: [],
      };

    case "APP_EXIT":
      if (
        state.type !== "idle" &&
        !sameInvocationRef(state.invocationRef, event.invocationRef)
      ) {
        return ignore(state, "stale-operation");
      }
      if (state.type === "ready" || state.type === "reloading") {
        return {
          kind: "applied",
          state: {
            type: "stopped",
            appId: state.appId,
            invocationRef: state.invocationRef,
            exitCode: event.exitCode,
          },
          commands: [],
        };
      }
      // During starting/stopping the IPC settlement drives the state (as
      // before); in idle/stopped/errored there is nothing to do. The exit
      // details atom is written by the output subscription either way.
      return ignore(state, "invalid-in-current-state");

    default:
      return assertNever(event);
  }
}

/** Explicitly ignore an event: same state reference, no commands. */
export function ignore(
  state: RunState,
  reason: Extract<TransitionResult, { kind: "ignored" }>["reason"],
): TransitionResult {
  return ignoreTransition(state, reason);
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

import { sameInvocationRef } from "@/state_machines/invocation_ref";
import {
  change,
  ignore as ignoreTransition,
  type IgnoreReason as SharedIgnoreReason,
  type TransitionResult,
} from "@/state_machines/types";
import type {
  McpOAuthEvent,
  McpOAuthFlowIdentity,
  McpOAuthState,
} from "./state";

export type IgnoreReason = SharedIgnoreReason<
  | "stale-invocation"
  | "state-mismatch"
  | "invalid-in-current-state"
  | "no-active-flow"
  | "duplicate-connect"
>;

export type McpOAuthTransitionResult = TransitionResult<
  McpOAuthState,
  never,
  IgnoreReason
>;

function eventIdentity(
  event: Extract<McpOAuthEvent, { type: "CONNECT" }>,
): McpOAuthFlowIdentity {
  return {
    invocationRef: event.invocationRef,
    rendererMessageId: event.rendererMessageId,
    expectedState: event.expectedState,
    serverId: event.serverId,
  };
}

function hasCurrentInvocation(
  state: McpOAuthState,
  event: Exclude<McpOAuthEvent, { type: "CONNECT" }>,
): boolean {
  if (state.status === "idle") return false;
  const active =
    state.status === "superseding"
      ? state.closing.invocationRef
      : state.invocationRef;
  return sameInvocationRef(active, event.invocationRef);
}

export function transition(
  state: McpOAuthState,
  event: McpOAuthEvent,
): McpOAuthTransitionResult {
  if (event.type === "CONNECT") {
    const next = eventIdentity(event);
    switch (state.status) {
      case "idle":
      case "connected":
      case "failed":
      case "timedOut":
        return change({ status: "binding", ...next });
      case "superseding":
        if (sameInvocationRef(state.next.invocationRef, next.invocationRef)) {
          return ignoreTransition(state, "duplicate-connect");
        }
        return change({ ...state, next });
      case "binding":
      case "awaitingCallback":
      case "exchanging":
        return change({
          status: "superseding",
          closing: {
            invocationRef: state.invocationRef,
            rendererMessageId: state.rendererMessageId,
            expectedState: state.expectedState,
            serverId: state.serverId,
          },
          next,
        });
      default:
        return unreachable(state);
    }
  }

  if (state.status === "idle") {
    return ignoreTransition(state, "no-active-flow");
  }
  if (!hasCurrentInvocation(state, event)) {
    return ignoreTransition(state, "stale-invocation");
  }

  switch (event.type) {
    case "SOCKETS_CLOSED":
      return state.status === "superseding"
        ? change({ status: "binding", ...state.next })
        : ignoreTransition(state, "invalid-in-current-state");
    case "BINDS_SETTLED":
      if (state.status !== "binding") {
        return ignoreTransition(state, "invalid-in-current-state");
      }
      if (event.anyInUse) {
        return change({
          ...state,
          status: "failed",
          message: "callback-port-in-use",
        });
      }
      if (event.boundHosts.length === 0) {
        return change({
          ...state,
          status: "failed",
          message: "callback-bind-failed",
        });
      }
      return change({ ...state, status: "awaitingCallback" });
    case "AUTHORIZED_SILENTLY":
      return state.status === "awaitingCallback"
        ? change({ ...state, status: "connected" })
        : ignoreTransition(state, "invalid-in-current-state");
    case "CALLBACK":
      if (state.status !== "awaitingCallback") {
        return ignoreTransition(state, "invalid-in-current-state");
      }
      if (event.state !== state.expectedState) {
        return ignoreTransition(state, "state-mismatch");
      }
      return event.code
        ? change({ ...state, status: "exchanging" })
        : change({
            ...state,
            status: "failed",
            message: `OAuth callback error: ${event.error ?? "missing code"}`,
          });
    case "TIMEOUT":
      return state.status === "binding" || state.status === "awaitingCallback"
        ? change({ ...state, status: "timedOut" })
        : ignoreTransition(state, "invalid-in-current-state");
    case "EXCHANGE_OK":
      return state.status === "exchanging"
        ? change({ ...state, status: "connected" })
        : ignoreTransition(state, "invalid-in-current-state");
    case "EXCHANGE_FAILED":
      return state.status === "binding" ||
        state.status === "awaitingCallback" ||
        state.status === "exchanging"
        ? change({ ...state, status: "failed", message: event.message })
        : ignoreTransition(state, "invalid-in-current-state");
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function unreachable(state: never): never {
  throw new Error(`Unreachable MCP OAuth state: ${JSON.stringify(state)}`);
}

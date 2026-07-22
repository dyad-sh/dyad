/** Pure, total transition function for one MCP OAuth callback port. */

import {
  advanceState,
  ignoreState,
  type IgnoreReason as SharedIgnoreReason,
  type StateTransitionResult,
} from "@/state_machines/types";
import type {
  McpOAuthEvent,
  McpOAuthFlowIdentity,
  McpOAuthState,
} from "./state";

export type IgnoreReason = SharedIgnoreReason<
  | "stale-flow"
  | "state-mismatch"
  | "invalid-in-current-state"
  | "no-active-flow"
  | "duplicate-connect"
>;

export type McpOAuthTransitionResult = StateTransitionResult<
  McpOAuthState,
  IgnoreReason
>;

function advance(state: McpOAuthState): McpOAuthTransitionResult {
  return advanceState(state);
}

function ignore(
  state: McpOAuthState,
  reason: IgnoreReason,
): McpOAuthTransitionResult {
  return ignoreState(state, reason);
}

function eventIdentity(event: Extract<McpOAuthEvent, { type: "CONNECT" }>) {
  return {
    flowId: event.flowId,
    expectedState: event.expectedState,
    serverId: event.serverId,
  } satisfies McpOAuthFlowIdentity;
}

function hasCurrentFlowId(state: McpOAuthState, flowId: string): boolean {
  if (state.status === "idle") return false;
  if (state.status === "superseding") {
    return state.closing.flowId === flowId;
  }
  return state.flowId === flowId;
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
      case "superseded":
      case "timedOut":
        return advance({ status: "binding", ...next });
      case "superseding":
        if (
          state.next.flowId === next.flowId &&
          state.next.expectedState === next.expectedState &&
          state.next.serverId === next.serverId
        ) {
          return ignore(state, "duplicate-connect");
        }
        return advance({ ...state, next });
      case "binding":
      case "awaitingCallback":
      case "exchanging":
        return advance({
          status: "superseding",
          closing: {
            flowId: state.flowId,
            expectedState: state.expectedState,
            serverId: state.serverId,
          },
          next,
        });
      default:
        return unreachable(state);
    }
  }

  if (state.status === "idle") return ignore(state, "no-active-flow");
  if (!hasCurrentFlowId(state, event.flowId)) {
    return ignore(state, "stale-flow");
  }

  switch (event.type) {
    case "SOCKETS_CLOSED":
      if (state.status !== "superseding") {
        return ignore(state, "invalid-in-current-state");
      }
      return advance({ status: "binding", ...state.next });

    case "BINDS_SETTLED":
      if (state.status !== "binding") {
        return ignore(state, "invalid-in-current-state");
      }
      if (event.anyInUse) {
        return advance({
          status: "failed",
          flowId: state.flowId,
          expectedState: state.expectedState,
          serverId: state.serverId,
          message: "callback-port-in-use",
        });
      }
      if (event.boundHosts.length === 0) {
        return advance({
          status: "failed",
          flowId: state.flowId,
          expectedState: state.expectedState,
          serverId: state.serverId,
          message: "callback-bind-failed",
        });
      }
      return advance({
        status: "awaitingCallback",
        flowId: state.flowId,
        expectedState: state.expectedState,
        serverId: state.serverId,
      });

    case "AUTHORIZED_SILENTLY":
      if (state.status !== "awaitingCallback") {
        return ignore(state, "invalid-in-current-state");
      }
      return advance({ ...state, status: "connected" });

    case "CALLBACK":
      if (state.status !== "awaitingCallback") {
        return ignore(state, "invalid-in-current-state");
      }
      if (event.state !== state.expectedState) {
        return ignore(state, "state-mismatch");
      }
      if (!event.code) {
        return advance({
          status: "failed",
          flowId: state.flowId,
          expectedState: state.expectedState,
          serverId: state.serverId,
          message: `OAuth callback error: ${event.error ?? "missing code"}`,
        });
      }
      return advance({ ...state, status: "exchanging" });

    case "TIMEOUT":
      if (state.status !== "binding" && state.status !== "awaitingCallback") {
        return ignore(state, "invalid-in-current-state");
      }
      return advance({ ...state, status: "timedOut" });

    case "EXCHANGE_OK":
      if (state.status !== "exchanging") {
        return ignore(state, "invalid-in-current-state");
      }
      return advance({ ...state, status: "connected" });

    case "EXCHANGE_FAILED":
      if (
        state.status !== "binding" &&
        state.status !== "awaitingCallback" &&
        state.status !== "exchanging"
      ) {
        return ignore(state, "invalid-in-current-state");
      }
      return advance({ ...state, status: "failed", message: event.message });

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function unreachable(state: never): McpOAuthTransitionResult {
  return state;
}

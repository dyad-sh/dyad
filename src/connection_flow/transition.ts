/**
 * Connection flow state machine — pure transition function.
 *
 * Total over the state × event matrix: every (state, event) pair either
 * transitions or is explicitly ignored with a reason — it never throws.
 * Mutually exclusive outcomes (e.g. a timeout racing an OAuth return) are
 * resolved here: whichever event arrives first wins the transition and the
 * loser is ignored, because the machine has already left the state the losing
 * event is valid in.
 *
 * This file must stay pure: no Electron, React, or other runtime imports.
 */

import type { ConnectionFlowEvent, ConnectionFlowState } from "./state";
import {
  advanceState,
  ignoreState,
  type IgnoreReason as SharedIgnoreReason,
  type StateTransitionResult,
} from "@/state_machines/types";

/** Why an event was ignored instead of transitioning the machine. */
export type IgnoreReason = SharedIgnoreReason<
  | "flow-already-active"
  | "no-active-flow"
  | "flow-id-mismatch"
  | "invalid-in-current-state"
>;

export type TransitionResult = StateTransitionResult<
  ConnectionFlowState,
  IgnoreReason
>;

function advance(state: ConnectionFlowState): TransitionResult {
  return advanceState(state);
}

/** Explicitly ignore an event, keeping the current state. */
function ignore(
  state: ConnectionFlowState,
  reason: IgnoreReason,
): TransitionResult {
  return ignoreState(state, reason);
}

export function transition(
  state: ConnectionFlowState,
  event: ConnectionFlowEvent,
): TransitionResult {
  switch (event.type) {
    case "start": {
      switch (state.status) {
        case "disconnected":
        case "connected":
        case "failed":
        case "cancelled":
          // A new flow may start from idle or from any terminal state
          // (retry after failure/cancel, reconnect after success).
          return advance({
            status: "starting",
            flowId: event.flowId,
            provider: event.provider,
          });
        case "starting":
        case "awaiting-return":
        case "exchanging-token":
        case "loading-resources":
          // Double-start (e.g. double-clicked Connect) is a no-op.
          return ignore(state, "flow-already-active");
        default:
          return unreachableState(state);
      }
    }

    case "prepared": {
      if (state.status === "disconnected") {
        return ignore(state, "no-active-flow");
      }
      if (state.flowId !== event.flowId) {
        return ignore(state, "flow-id-mismatch");
      }
      switch (state.status) {
        case "starting":
          return advance({
            status: "awaiting-return",
            flowId: state.flowId,
            provider: state.provider,
            userCode: event.userCode,
            verificationUri: event.verificationUri,
          });
        case "awaiting-return":
        case "exchanging-token":
        case "loading-resources":
        case "connected":
        case "failed":
        case "cancelled":
          return ignore(state, "invalid-in-current-state");
        default:
          return unreachableState(state);
      }
    }

    case "return-received": {
      if (state.status === "disconnected") {
        return ignore(state, "no-active-flow");
      }
      if (state.flowId !== event.flowId) {
        return ignore(state, "flow-id-mismatch");
      }
      switch (state.status) {
        case "awaiting-return":
          return advance({
            status: "exchanging-token",
            flowId: state.flowId,
            provider: state.provider,
          });
        case "starting":
        case "exchanging-token":
        case "loading-resources":
        case "connected":
        // In particular: a return arriving after the flow already failed
        // (e.g. by timeout) is ignored — the timeout won the race. The
        // token write itself is handled outside the machine as an
        // unsolicited return.
        case "failed":
        case "cancelled":
          return ignore(state, "invalid-in-current-state");
        default:
          return unreachableState(state);
      }
    }

    case "token-exchanged": {
      if (state.status === "disconnected") {
        return ignore(state, "no-active-flow");
      }
      if (state.flowId !== event.flowId) {
        return ignore(state, "flow-id-mismatch");
      }
      switch (state.status) {
        case "exchanging-token":
          return advance({
            status: "loading-resources",
            flowId: state.flowId,
            provider: state.provider,
          });
        case "starting":
        case "awaiting-return":
        case "loading-resources":
        case "connected":
        case "failed":
        case "cancelled":
          return ignore(state, "invalid-in-current-state");
        default:
          return unreachableState(state);
      }
    }

    case "resources-loaded": {
      if (state.status === "disconnected") {
        return ignore(state, "no-active-flow");
      }
      if (state.flowId !== event.flowId) {
        return ignore(state, "flow-id-mismatch");
      }
      switch (state.status) {
        case "loading-resources":
          return advance({
            status: "connected",
            flowId: state.flowId,
            provider: state.provider,
          });
        case "starting":
        case "awaiting-return":
        case "exchanging-token":
        case "connected":
        case "failed":
        case "cancelled":
          return ignore(state, "invalid-in-current-state");
        default:
          return unreachableState(state);
      }
    }

    case "timeout": {
      if (state.status === "disconnected") {
        return ignore(state, "no-active-flow");
      }
      if (state.flowId !== event.flowId) {
        return ignore(state, "flow-id-mismatch");
      }
      switch (state.status) {
        case "starting":
        case "awaiting-return":
          return advance({
            status: "failed",
            flowId: state.flowId,
            provider: state.provider,
            reason: "timeout",
          });
        // Once the return has been received (or the flow otherwise ended)
        // a late timeout is ignored — the return won the race. Timeout and
        // success are mutually exclusive by construction.
        case "exchanging-token":
        case "loading-resources":
        case "connected":
        case "failed":
        case "cancelled":
          return ignore(state, "invalid-in-current-state");
        default:
          return unreachableState(state);
      }
    }

    case "cancel": {
      if (state.status === "disconnected") {
        return ignore(state, "no-active-flow");
      }
      if (state.flowId !== event.flowId) {
        return ignore(state, "flow-id-mismatch");
      }
      switch (state.status) {
        case "starting":
        case "awaiting-return":
        case "exchanging-token":
        case "loading-resources":
          return advance({
            status: "cancelled",
            flowId: state.flowId,
            provider: state.provider,
          });
        case "connected":
        case "failed":
        case "cancelled":
          return ignore(state, "invalid-in-current-state");
        default:
          return unreachableState(state);
      }
    }

    case "fail": {
      if (state.status === "disconnected") {
        return ignore(state, "no-active-flow");
      }
      if (state.flowId !== event.flowId) {
        return ignore(state, "flow-id-mismatch");
      }
      switch (state.status) {
        case "starting":
        case "awaiting-return":
        case "exchanging-token":
        case "loading-resources":
          return advance({
            status: "failed",
            flowId: state.flowId,
            provider: state.provider,
            reason: event.reason,
            message: event.message,
          });
        case "connected":
        case "failed":
        case "cancelled":
          return ignore(state, "invalid-in-current-state");
        default:
          return unreachableState(state);
      }
    }

    case "acknowledge": {
      if (state.status === "disconnected") {
        return ignore(state, "no-active-flow");
      }
      if (state.flowId !== event.flowId) {
        return ignore(state, "flow-id-mismatch");
      }
      switch (state.status) {
        case "connected":
        case "failed":
        case "cancelled":
          return advance({ status: "disconnected" });
        case "starting":
        case "awaiting-return":
        case "exchanging-token":
        case "loading-resources":
          return ignore(state, "invalid-in-current-state");
        default:
          return unreachableState(state);
      }
    }

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function unreachableState(state: never): TransitionResult {
  return state;
}

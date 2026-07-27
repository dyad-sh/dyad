/**
 * Pure connection-flow transition function.
 *
 * Correlation uses the complete typed invocation reference. Every applied
 * transition advances the authoritative revision exposed to renderers.
 */

import { sameInvocationRef } from "@/state_machines/invocation_ref";
import {
  change,
  ignore as ignoreTransition,
  type IgnoreReason as SharedIgnoreReason,
  type TransitionResult as SharedTransitionResult,
} from "@/state_machines/types";
import type { ConnectionFlowEvent, ConnectionFlowState } from "./state";

export type IgnoreReason = SharedIgnoreReason<
  | "flow-already-active"
  | "no-active-flow"
  | "invocation-mismatch"
  | "invalid-in-current-state"
>;

export type TransitionResult = SharedTransitionResult<
  ConnectionFlowState,
  never,
  IgnoreReason
>;

type UnrevisionedState<
  State extends ConnectionFlowState = ConnectionFlowState,
> = State extends ConnectionFlowState ? Omit<State, "revision"> : never;

function advance(
  previous: ConnectionFlowState,
  state: UnrevisionedState,
): TransitionResult {
  return change({
    ...state,
    revision: previous.revision + 1,
  } as ConnectionFlowState);
}

function ignore(
  state: ConnectionFlowState,
  reason: IgnoreReason,
): TransitionResult {
  return ignoreTransition(state, reason);
}

function hasMatchingInvocation(
  state: Exclude<ConnectionFlowState, { status: "disconnected" }>,
  event: Exclude<ConnectionFlowEvent, { type: "start" }>,
): boolean {
  return sameInvocationRef(state.invocationRef, event.invocationRef);
}

export function transition(
  state: ConnectionFlowState,
  event: ConnectionFlowEvent,
): TransitionResult {
  if (event.type === "start") {
    switch (state.status) {
      case "disconnected":
      case "connected":
      case "failed":
      case "cancelled":
        return advance(state, {
          status: "starting",
          invocationRef: event.invocationRef,
          provider: event.provider,
        });
      case "starting":
      case "awaiting-return":
      case "exchanging-token":
        return ignore(state, "flow-already-active");
      default:
        return unreachableState(state);
    }
  }

  if (state.status === "disconnected") {
    return ignore(state, "no-active-flow");
  }
  if (!hasMatchingInvocation(state, event)) {
    return ignore(state, "invocation-mismatch");
  }

  switch (event.type) {
    case "prepared":
      if (state.status !== "starting") {
        return ignore(state, "invalid-in-current-state");
      }
      return advance(state, {
        status: "awaiting-return",
        invocationRef: state.invocationRef,
        provider: state.provider,
        userCode: event.userCode,
        verificationUri: event.verificationUri,
      });

    case "return-received":
      if (state.status !== "awaiting-return") {
        return ignore(state, "invalid-in-current-state");
      }
      return advance(state, {
        status: "exchanging-token",
        invocationRef: state.invocationRef,
        provider: state.provider,
      });

    case "token-exchanged":
      if (state.status !== "exchanging-token") {
        return ignore(state, "invalid-in-current-state");
      }
      return advance(state, {
        status: "connected",
        invocationRef: state.invocationRef,
        provider: state.provider,
      });

    case "timeout":
      if (state.status !== "starting" && state.status !== "awaiting-return") {
        return ignore(state, "invalid-in-current-state");
      }
      return advance(state, {
        status: "failed",
        invocationRef: state.invocationRef,
        provider: state.provider,
        reason: "timeout",
      });

    case "cancel":
      if (
        state.status !== "starting" &&
        state.status !== "awaiting-return" &&
        state.status !== "exchanging-token"
      ) {
        return ignore(state, "invalid-in-current-state");
      }
      return advance(state, {
        status: "cancelled",
        invocationRef: state.invocationRef,
        provider: state.provider,
      });

    case "fail":
      if (
        state.status !== "starting" &&
        state.status !== "awaiting-return" &&
        state.status !== "exchanging-token"
      ) {
        return ignore(state, "invalid-in-current-state");
      }
      return advance(state, {
        status: "failed",
        invocationRef: state.invocationRef,
        provider: state.provider,
        reason: event.reason,
        message: event.message,
      });

    case "acknowledge":
      if (
        state.status !== "connected" &&
        state.status !== "failed" &&
        state.status !== "cancelled"
      ) {
        return ignore(state, "invalid-in-current-state");
      }
      return advance(state, { status: "disconnected" });

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function unreachableState(state: never): never {
  throw new Error(
    `Unreachable connection-flow state: ${JSON.stringify(state)}`,
  );
}

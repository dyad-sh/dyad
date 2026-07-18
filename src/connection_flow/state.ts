/**
 * Connection flow state machine — shared types.
 *
 * These types are shared between the main process (which owns the
 * authoritative flow state) and the renderer (which is a thin projection of
 * it). This file must stay pure: no Electron, React, or other runtime
 * imports so it can be consumed from any process and unit-tested trivially.
 */

/** Providers whose OAuth/connection flows are driven by the state machine. */
export type ConnectionFlowProvider = "github" | "supabase" | "neon";

export const CONNECTION_FLOW_PROVIDERS: readonly ConnectionFlowProvider[] = [
  "github",
  "supabase",
  "neon",
];

/** Why a flow ended in the `failed` state. */
export type ConnectionFlowFailureReason =
  | "user_cancelled"
  | "timeout"
  | "token_invalid"
  | "network";

/**
 * One provider's connection flow state.
 *
 * Lifecycle:
 *   disconnected → starting → awaiting-return → exchanging-token
 *     → loading-resources → connected | failed(reason) | cancelled
 *
 * Every non-idle state carries the `flowId` allocated when the flow started.
 * Events are correlated by flowId so stale timers or duplicate OAuth returns
 * can never advance (or corrupt) a different flow's state.
 */
export type ConnectionFlowState =
  | { status: "disconnected" }
  | { status: "starting"; flowId: string; provider: ConnectionFlowProvider }
  | {
      status: "awaiting-return";
      flowId: string;
      provider: ConnectionFlowProvider;
      /** GitHub device flow: code the user enters at the verification URI. */
      userCode?: string;
      /** GitHub device flow: where the user enters the code. */
      verificationUri?: string;
    }
  | {
      status: "exchanging-token";
      flowId: string;
      provider: ConnectionFlowProvider;
    }
  | {
      status: "loading-resources";
      flowId: string;
      provider: ConnectionFlowProvider;
    }
  | { status: "connected"; flowId: string; provider: ConnectionFlowProvider }
  | {
      status: "failed";
      flowId: string;
      provider: ConnectionFlowProvider;
      reason: ConnectionFlowFailureReason;
      message?: string;
    }
  | { status: "cancelled"; flowId: string; provider: ConnectionFlowProvider };

export type ConnectionFlowStatus = ConnectionFlowState["status"];

/** The idle state every provider starts (and is reset) to. */
export const DISCONNECTED_FLOW_STATE: ConnectionFlowState = {
  status: "disconnected",
};

/**
 * Events that drive the machine. All events except `start` carry the flowId
 * of the flow they belong to; mismatching events are ignored.
 */
export type ConnectionFlowEvent =
  | { type: "start"; flowId: string; provider: ConnectionFlowProvider }
  | {
      type: "prepared";
      flowId: string;
      userCode?: string;
      verificationUri?: string;
    }
  | { type: "return-received"; flowId: string }
  | { type: "token-exchanged"; flowId: string }
  | { type: "resources-loaded"; flowId: string }
  | { type: "timeout"; flowId: string }
  | { type: "cancel"; flowId: string }
  | {
      type: "fail";
      flowId: string;
      reason: ConnectionFlowFailureReason;
      message?: string;
    }
  | { type: "acknowledge"; flowId: string };

export type ConnectionFlowEventType = ConnectionFlowEvent["type"];

/** A flow that has started but not yet reached a terminal state. */
export function isActiveFlowState(state: ConnectionFlowState): boolean {
  switch (state.status) {
    case "starting":
    case "awaiting-return":
    case "exchanging-token":
    case "loading-resources":
      return true;
    case "disconnected":
    case "connected":
    case "failed":
    case "cancelled":
      return false;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/** Terminal states: the flow is over and awaits acknowledgement. */
export function isTerminalFlowState(state: ConnectionFlowState): boolean {
  switch (state.status) {
    case "connected":
    case "failed":
    case "cancelled":
      return true;
    case "disconnected":
    case "starting":
    case "awaiting-return":
    case "exchanging-token":
    case "loading-resources":
      return false;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

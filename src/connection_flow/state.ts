/**
 * Connection flow state machine — shared types.
 *
 * Main owns the authoritative lifecycle. Renderers receive only this narrow,
 * revisioned projection and must echo its invocation reference for correlated
 * intents.
 */

import type { InvocationRef } from "@/state_machines/invocation_ref";

export type ConnectionFlowProvider = "github" | "supabase" | "neon";

export const CONNECTION_FLOW_PROVIDERS: readonly ConnectionFlowProvider[] = [
  "github",
  "supabase",
  "neon",
];

export const CONNECTION_FLOW_INVOCATION_KIND = "connection-flow";

export type ConnectionFlowInvocationRef = InvocationRef<
  typeof CONNECTION_FLOW_INVOCATION_KIND,
  ConnectionFlowProvider
>;

export type ConnectionFlowFailureReason =
  | "user_cancelled"
  | "timeout"
  | "token_invalid"
  | "network";

interface RevisionedState {
  revision: number;
}

interface InvokedState extends RevisionedState {
  invocationRef: ConnectionFlowInvocationRef;
  provider: ConnectionFlowProvider;
}

export type ConnectionFlowState =
  | ({ status: "disconnected" } & RevisionedState)
  | ({ status: "starting" } & InvokedState)
  | ({
      status: "awaiting-return";
      userCode?: string;
      verificationUri?: string;
    } & InvokedState)
  | ({ status: "exchanging-token" } & InvokedState)
  | ({ status: "connected" } & InvokedState)
  | ({
      status: "failed";
      reason: ConnectionFlowFailureReason;
      message?: string;
    } & InvokedState)
  | ({ status: "cancelled" } & InvokedState);

export type ConnectionFlowStatus = ConnectionFlowState["status"];

export const DISCONNECTED_FLOW_STATE: ConnectionFlowState = {
  status: "disconnected",
  revision: 0,
};

export type ConnectionFlowEvent =
  | {
      type: "start";
      invocationRef: ConnectionFlowInvocationRef;
      provider: ConnectionFlowProvider;
    }
  | {
      type: "prepared";
      invocationRef: ConnectionFlowInvocationRef;
      userCode?: string;
      verificationUri?: string;
    }
  | {
      type: "return-received";
      invocationRef: ConnectionFlowInvocationRef;
    }
  | {
      type: "token-exchanged";
      invocationRef: ConnectionFlowInvocationRef;
    }
  | { type: "timeout"; invocationRef: ConnectionFlowInvocationRef }
  | { type: "cancel"; invocationRef: ConnectionFlowInvocationRef }
  | {
      type: "fail";
      invocationRef: ConnectionFlowInvocationRef;
      reason: ConnectionFlowFailureReason;
      message?: string;
    }
  | {
      type: "acknowledge";
      invocationRef: ConnectionFlowInvocationRef;
    };

export type ConnectionFlowEventType = ConnectionFlowEvent["type"];

export function isActiveFlowState(state: ConnectionFlowState): boolean {
  switch (state.status) {
    case "starting":
    case "awaiting-return":
    case "exchanging-token":
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
      return false;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

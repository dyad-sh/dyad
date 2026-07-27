/**
 * Private MCP OAuth lifecycle types.
 *
 * The typed invocation reference is correlation identity across listeners,
 * waiters, timers, callbacks, exchange, and settlement. `rendererMessageId`
 * is a separate retry-idempotency identity supplied by the renderer.
 */

import type { InvocationRef } from "@/state_machines/invocation_ref";

export const MCP_OAUTH_INVOCATION_KIND = "mcp-oauth";

export type McpOAuthInvocationRef = InvocationRef<
  typeof MCP_OAUTH_INVOCATION_KIND,
  number
>;

export interface McpOAuthFlowIdentity {
  invocationRef: McpOAuthInvocationRef;
  rendererMessageId: string;
  expectedState: string;
  serverId: number;
}

export type McpOAuthState =
  | { status: "idle" }
  | ({ status: "binding" } & McpOAuthFlowIdentity)
  | ({ status: "awaitingCallback" } & McpOAuthFlowIdentity)
  | ({ status: "exchanging" } & McpOAuthFlowIdentity)
  | {
      status: "superseding";
      closing: McpOAuthFlowIdentity;
      next: McpOAuthFlowIdentity;
    }
  | ({ status: "connected" } & McpOAuthFlowIdentity)
  | ({ status: "failed"; message: string } & McpOAuthFlowIdentity)
  | ({ status: "timedOut" } & McpOAuthFlowIdentity);

export const IDLE_MCP_OAUTH_STATE: McpOAuthState = { status: "idle" };

export type McpOAuthEvent =
  | ({ type: "CONNECT" } & McpOAuthFlowIdentity)
  | { type: "SOCKETS_CLOSED"; invocationRef: McpOAuthInvocationRef }
  | {
      type: "BINDS_SETTLED";
      invocationRef: McpOAuthInvocationRef;
      boundHosts: readonly string[];
      anyInUse: boolean;
    }
  | {
      type: "AUTHORIZED_SILENTLY";
      invocationRef: McpOAuthInvocationRef;
    }
  | {
      type: "CALLBACK";
      invocationRef: McpOAuthInvocationRef;
      state: string | null;
      code?: string;
      error?: string;
    }
  | { type: "TIMEOUT"; invocationRef: McpOAuthInvocationRef }
  | { type: "EXCHANGE_OK"; invocationRef: McpOAuthInvocationRef }
  | {
      type: "EXCHANGE_FAILED";
      invocationRef: McpOAuthInvocationRef;
      message: string;
    };

export function identityOf(state: McpOAuthState): McpOAuthFlowIdentity | null {
  switch (state.status) {
    case "idle":
      return null;
    case "superseding":
      return state.closing;
    case "binding":
    case "awaitingCallback":
    case "exchanging":
    case "connected":
    case "failed":
    case "timedOut":
      return state;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function isTerminalMcpOAuthState(state: McpOAuthState): boolean {
  return (
    state.status === "connected" ||
    state.status === "failed" ||
    state.status === "timedOut"
  );
}

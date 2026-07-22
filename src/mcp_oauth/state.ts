/**
 * MCP OAuth loopback state machine — pure per-port lifecycle types.
 *
 * A callback port is the concurrency boundary: different MCP servers may use
 * the same configured port, but only one listener can own it at a time. Every
 * asynchronous event is correlated with a flowId minted by the registry.
 */

export interface McpOAuthFlowIdentity {
  flowId: string;
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
  | ({ status: "superseded" } & McpOAuthFlowIdentity)
  | ({ status: "timedOut" } & McpOAuthFlowIdentity);

export const IDLE_MCP_OAUTH_STATE: McpOAuthState = { status: "idle" };

export type McpOAuthEvent =
  | ({ type: "CONNECT" } & McpOAuthFlowIdentity)
  | { type: "SOCKETS_CLOSED"; flowId: string }
  | {
      type: "BINDS_SETTLED";
      flowId: string;
      boundHosts: readonly string[];
      anyInUse: boolean;
    }
  | { type: "AUTHORIZED_SILENTLY"; flowId: string }
  | {
      type: "CALLBACK";
      flowId: string;
      state: string | null;
      code?: string;
      error?: string;
    }
  | { type: "TIMEOUT"; flowId: string }
  | { type: "EXCHANGE_OK"; flowId: string }
  | { type: "EXCHANGE_FAILED"; flowId: string; message: string };

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
    case "superseded":
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
    state.status === "superseded" ||
    state.status === "timedOut"
  );
}

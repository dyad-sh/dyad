import { describe, expect, it } from "vitest";
import type {
  McpOAuthEvent,
  McpOAuthFlowIdentity,
  McpOAuthInvocationRef,
  McpOAuthState,
} from "./state";
import { transition } from "./transition";

function ref(serverId: number, operationId: string): McpOAuthInvocationRef {
  return {
    kind: "mcp-oauth",
    entityKey: serverId,
    operationId,
  };
}

function identity(serverId: number, operationId: string): McpOAuthFlowIdentity {
  return {
    invocationRef: ref(serverId, operationId),
    rendererMessageId: `message-${operationId}`,
    expectedState: `state-${operationId}`,
    serverId,
  };
}

describe("MCP OAuth transition", () => {
  it("walks binding, callback, exchange, and connected with one ref", () => {
    const flow = identity(1, "one");
    let state: McpOAuthState = { status: "idle" };
    const apply = (event: McpOAuthEvent) => {
      const result = transition(state, event);
      expect(result.kind).toBe("applied");
      state = result.state;
    };

    apply({ type: "CONNECT", ...flow });
    apply({
      type: "BINDS_SETTLED",
      invocationRef: flow.invocationRef,
      boundHosts: ["127.0.0.1"],
      anyInUse: false,
    });
    apply({
      type: "CALLBACK",
      invocationRef: flow.invocationRef,
      state: flow.expectedState,
      code: "code",
    });
    apply({ type: "EXCHANGE_OK", invocationRef: flow.invocationRef });
    expect(state).toMatchObject({
      status: "connected",
      invocationRef: flow.invocationRef,
    });
  });

  it("rejects stale refs across asynchronous boundaries", () => {
    const flow = identity(1, "active");
    const stale = ref(1, "stale");
    const state: McpOAuthState = {
      status: "awaitingCallback",
      ...flow,
    };
    const events: McpOAuthEvent[] = [
      { type: "SOCKETS_CLOSED", invocationRef: stale },
      {
        type: "BINDS_SETTLED",
        invocationRef: stale,
        boundHosts: [],
        anyInUse: false,
      },
      { type: "AUTHORIZED_SILENTLY", invocationRef: stale },
      {
        type: "CALLBACK",
        invocationRef: stale,
        state: flow.expectedState,
        code: "code",
      },
      { type: "TIMEOUT", invocationRef: stale },
      { type: "EXCHANGE_OK", invocationRef: stale },
      {
        type: "EXCHANGE_FAILED",
        invocationRef: stale,
        message: "failure",
      },
    ];
    for (const event of events) {
      expect(transition(state, event)).toEqual({
        kind: "ignored",
        state,
        reason: "stale-invocation",
      });
    }
  });

  it("supersedes an active flow with a distinct invocation", () => {
    const first = identity(1, "first");
    const second = identity(2, "second");
    const result = transition(
      { status: "awaitingCallback", ...first },
      { type: "CONNECT", ...second },
    );
    expect(result).toMatchObject({
      kind: "applied",
      state: {
        status: "superseding",
        closing: first,
        next: second,
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import { exploreReachableStates } from "@/state_machines/testing";
import {
  IDLE_MCP_OAUTH_STATE,
  type McpOAuthEvent,
  type McpOAuthState,
} from "./state";
import { transition } from "./transition";

const flow = (flowId: string) => ({
  flowId,
  expectedState: `state-${flowId}`,
  serverId: Number(flowId.replace(/\D/g, "")) || 1,
});

function eventsFor(state: McpOAuthState): readonly McpOAuthEvent[] {
  const currentFlowId =
    state.status === "idle"
      ? "flow-1"
      : state.status === "superseding"
        ? state.closing.flowId
        : state.flowId;
  const expectedState =
    state.status === "awaitingCallback" ? state.expectedState : "state-flow-1";
  return [
    { type: "CONNECT", ...flow("flow-1") },
    { type: "CONNECT", ...flow("flow-2") },
    { type: "SOCKETS_CLOSED", flowId: currentFlowId },
    {
      type: "BINDS_SETTLED",
      flowId: currentFlowId,
      boundHosts: ["127.0.0.1"],
      anyInUse: false,
    },
    {
      type: "BINDS_SETTLED",
      flowId: currentFlowId,
      boundHosts: [],
      anyInUse: true,
    },
    { type: "AUTHORIZED_SILENTLY", flowId: currentFlowId },
    {
      type: "CALLBACK",
      flowId: currentFlowId,
      state: expectedState,
      code: "code",
    },
    {
      type: "CALLBACK",
      flowId: currentFlowId,
      state: "wrong-state",
      code: "code",
    },
    { type: "TIMEOUT", flowId: currentFlowId },
    { type: "EXCHANGE_OK", flowId: currentFlowId },
    {
      type: "EXCHANGE_FAILED",
      flowId: currentFlowId,
      message: "failed",
    },
    { type: "TIMEOUT", flowId: "stale-flow" },
  ];
}

function stateKey(state: McpOAuthState): string {
  switch (state.status) {
    case "idle":
      return state.status;
    case "superseding":
      return `${state.status}:${state.closing.flowId}:${state.next.flowId}`;
    case "failed":
      return `${state.status}:${state.flowId}:${state.message}`;
    default:
      return `${state.status}:${state.flowId}`;
  }
}

describe("MCP OAuth transition", () => {
  it("is total over every event in every reachable phase", () => {
    const states = exploreReachableStates({
      initialState: IDLE_MCP_OAUTH_STATE,
      events: eventsFor,
      transition: (state, event) => {
        const result = transition(state, event);
        return result.changed
          ? { state: result.state, commands: [] }
          : {
              state: result.state,
              commands: [],
              ignoredReason: result.reason,
            };
      },
      stateKey,
      maxStates: 100,
    });

    expect(states.map((state) => state.status)).toEqual(
      expect.arrayContaining([
        "idle",
        "binding",
        "awaitingCallback",
        "exchanging",
        "superseding",
        "connected",
        "failed",
        "timedOut",
      ]),
    );
    for (const state of states) {
      for (const event of eventsFor(state)) {
        const result = transition(state, event);
        expect(result).toBeDefined();
        if (result.changed) {
          expect(result.state).not.toEqual(state);
        } else {
          expect(result.state).toBe(state);
        }
      }
    }
  });

  it("keeps a mismatched callback alive and reference-stable", () => {
    const state: McpOAuthState = {
      status: "awaitingCallback",
      ...flow("flow-1"),
    };
    const result = transition(state, {
      type: "CALLBACK",
      flowId: "flow-1",
      state: "old-browser-tab",
      code: "code",
    });

    expect(result).toEqual({
      changed: false,
      state,
      reason: "state-mismatch",
    });
    expect(result.state).toBe(state);
  });

  it("replaces the queued flow during supersede without losing the closing owner", () => {
    const first = { status: "binding", ...flow("flow-1") } as const;
    const second = transition(first, {
      type: "CONNECT",
      ...flow("flow-2"),
    });
    expect(second.changed).toBe(true);
    const third = transition(second.state, {
      type: "CONNECT",
      ...flow("flow-3"),
    });

    expect(third.state).toEqual({
      status: "superseding",
      closing: flow("flow-1"),
      next: flow("flow-3"),
    });
  });

  it("ignores a duplicate queued Connect without allocating a snapshot", () => {
    const state: McpOAuthState = {
      status: "superseding",
      closing: flow("flow-1"),
      next: flow("flow-2"),
    };

    const result = transition(state, {
      type: "CONNECT",
      ...flow("flow-2"),
    });

    expect(result).toEqual({
      changed: false,
      state,
      reason: "duplicate-connect",
    });
    expect(result.state).toBe(state);
  });
});

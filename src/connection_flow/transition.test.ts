import { describe, expect, it } from "vitest";
import {
  assertAllCommandsProducible,
  assertAllStatesReachable,
} from "@/state_machines/testing";

import {
  CONNECTION_FLOW_PROVIDERS,
  isActiveFlowState,
  isTerminalFlowState,
  type ConnectionFlowEvent,
  type ConnectionFlowState,
} from "./state";
import { transition } from "./transition";

const FLOW_ID = "flow-1";
const OTHER_FLOW_ID = "flow-2";
const PROVIDER = "neon";
const STATE_KINDS = [
  "disconnected",
  "starting",
  "awaiting-return",
  "exchanging-token",
  "loading-resources",
  "connected",
  "failed",
  "cancelled",
] as const satisfies readonly ConnectionFlowState["status"][];
const COMMAND_KINDS = [] as const satisfies readonly never[];

/** One representative state per status, all belonging to FLOW_ID. */
const ALL_STATES: ConnectionFlowState[] = [
  { status: "disconnected" },
  { status: "starting", flowId: FLOW_ID, provider: PROVIDER },
  {
    status: "awaiting-return",
    flowId: FLOW_ID,
    provider: PROVIDER,
    userCode: "CODE-123",
    verificationUri: "https://example.com/device",
  },
  { status: "exchanging-token", flowId: FLOW_ID, provider: PROVIDER },
  { status: "loading-resources", flowId: FLOW_ID, provider: PROVIDER },
  { status: "connected", flowId: FLOW_ID, provider: PROVIDER },
  {
    status: "failed",
    flowId: FLOW_ID,
    provider: PROVIDER,
    reason: "timeout",
  },
  { status: "cancelled", flowId: FLOW_ID, provider: PROVIDER },
];

function eventsWithFlowId(flowId: string): ConnectionFlowEvent[] {
  return [
    { type: "start", flowId, provider: PROVIDER },
    {
      type: "prepared",
      flowId,
      userCode: "CODE-456",
      verificationUri: "https://example.com/device",
    },
    { type: "return-received", flowId },
    { type: "token-exchanged", flowId },
    { type: "resources-loaded", flowId },
    { type: "timeout", flowId },
    { type: "cancel", flowId },
    { type: "fail", flowId, reason: "network", message: "boom" },
    { type: "acknowledge", flowId },
  ];
}

describe("transition totality", () => {
  it("throws when an impossible state reaches the exhaustiveness helper", () => {
    expect(() =>
      transition({ status: "future" } as unknown as ConnectionFlowState, {
        type: "start",
        flowId: FLOW_ID,
        provider: PROVIDER,
      }),
    ).toThrow(/Unreachable connection-flow state/);
  });

  it("reaches every state and has an explicit empty command inventory", () => {
    const options = {
      initialState: { status: "disconnected" } as ConnectionFlowState,
      events: eventsWithFlowId(FLOW_ID),
      transition,
      stateKey: JSON.stringify,
    };
    assertAllStatesReachable({
      ...options,
      inventory: STATE_KINDS,
      stateKind: (state) => state.status,
    });
    assertAllCommandsProducible({
      ...options,
      inventory: COMMAND_KINDS,
      commandKind: (command: never) => command,
    });
  });

  it("handles every state x event combination without throwing", () => {
    const events = [
      ...eventsWithFlowId(FLOW_ID),
      ...eventsWithFlowId(OTHER_FLOW_ID),
    ];
    for (const state of ALL_STATES) {
      for (const event of events) {
        const result = transition(state, event);
        expect(result).toBeDefined();
        if (result.kind === "applied") {
          expect(result.state).not.toBe(state);
        } else {
          // Ignored events never mutate state and always carry a reason.
          expect(result.state).toBe(state);
          expect(result.reason).toBeTruthy();
        }
      }
    }
  });

  it("covers the full state x event matrix (8 statuses x 9 event types)", () => {
    const statuses = new Set(ALL_STATES.map((s) => s.status));
    const eventTypes = new Set(eventsWithFlowId(FLOW_ID).map((e) => e.type));
    expect(statuses.size).toBe(8);
    expect(eventTypes.size).toBe(9);
  });
});

describe("flowId correlation", () => {
  it("never advances state on a flowId mismatch", () => {
    for (const state of ALL_STATES) {
      if (state.status === "disconnected") continue;
      for (const event of eventsWithFlowId(OTHER_FLOW_ID)) {
        if (event.type === "start") continue; // start allocates a new flowId
        const result = transition(state, event);
        expect(result.kind === "applied").toBe(false);
        if (result.kind === "ignored") {
          expect(result.reason).toBe("flow-id-mismatch");
        }
      }
    }
  });

  it("ignores all non-start events when no flow exists", () => {
    for (const event of eventsWithFlowId(FLOW_ID)) {
      if (event.type === "start") continue;
      const result = transition({ status: "disconnected" }, event);
      expect(result.kind === "applied").toBe(false);
      if (result.kind === "ignored") {
        expect(result.reason).toBe("no-active-flow");
      }
    }
  });
});

describe("double-start protection", () => {
  it("is a no-op while a flow is active", () => {
    for (const state of ALL_STATES.filter(isActiveFlowState)) {
      const result = transition(state, {
        type: "start",
        flowId: OTHER_FLOW_ID,
        provider: PROVIDER,
      });
      expect(result.kind === "applied").toBe(false);
      if (result.kind === "ignored") {
        expect(result.reason).toBe("flow-already-active");
      }
    }
  });

  it("allows a fresh start from idle and terminal states", () => {
    for (const state of ALL_STATES.filter((s) => !isActiveFlowState(s))) {
      const result = transition(state, {
        type: "start",
        flowId: OTHER_FLOW_ID,
        provider: PROVIDER,
      });
      expect(result.kind === "applied").toBe(true);
      if (result.kind === "applied") {
        expect(result.state).toEqual({
          status: "starting",
          flowId: OTHER_FLOW_ID,
          provider: PROVIDER,
        });
      }
    }
  });
});

describe("timeout / return mutual exclusion", () => {
  const awaiting: ConnectionFlowState = {
    status: "awaiting-return",
    flowId: FLOW_ID,
    provider: PROVIDER,
  };

  it("timeout first: the later return is ignored", () => {
    const timedOut = transition(awaiting, { type: "timeout", flowId: FLOW_ID });
    expect(timedOut.kind === "applied").toBe(true);
    expect(timedOut.state).toMatchObject({
      status: "failed",
      reason: "timeout",
    });

    const lateReturn = transition(timedOut.state, {
      type: "return-received",
      flowId: FLOW_ID,
    });
    expect(lateReturn.kind === "applied").toBe(false);
    expect(lateReturn.state).toBe(timedOut.state);
  });

  it("return first: the later timeout is ignored", () => {
    const returned = transition(awaiting, {
      type: "return-received",
      flowId: FLOW_ID,
    });
    expect(returned.kind === "applied").toBe(true);
    expect(returned.state).toMatchObject({ status: "exchanging-token" });

    const lateTimeout = transition(returned.state, {
      type: "timeout",
      flowId: FLOW_ID,
    });
    expect(lateTimeout.kind === "applied").toBe(false);
    expect(lateTimeout.state).toBe(returned.state);
  });

  it("a timeout can never fire from any post-return state", () => {
    for (const state of ALL_STATES) {
      if (state.status === "starting" || state.status === "awaiting-return") {
        continue;
      }
      const result = transition(state, { type: "timeout", flowId: FLOW_ID });
      expect(result.kind === "applied").toBe(false);
    }
  });
});

describe("happy path", () => {
  it("walks disconnected -> ... -> connected -> disconnected", () => {
    for (const provider of CONNECTION_FLOW_PROVIDERS) {
      let state: ConnectionFlowState = { status: "disconnected" };
      const apply = (event: ConnectionFlowEvent) => {
        const result = transition(state, event);
        expect(result.kind === "applied").toBe(true);
        state = result.state;
      };

      apply({ type: "start", flowId: FLOW_ID, provider });
      expect(state.status).toBe("starting");
      apply({ type: "prepared", flowId: FLOW_ID, userCode: "ABCD" });
      expect(state).toMatchObject({
        status: "awaiting-return",
        userCode: "ABCD",
      });
      apply({ type: "return-received", flowId: FLOW_ID });
      expect(state.status).toBe("exchanging-token");
      apply({ type: "token-exchanged", flowId: FLOW_ID });
      expect(state.status).toBe("loading-resources");
      apply({ type: "resources-loaded", flowId: FLOW_ID });
      expect(state.status).toBe("connected");
      expect(isTerminalFlowState(state)).toBe(true);
      apply({ type: "acknowledge", flowId: FLOW_ID });
      expect(state.status).toBe("disconnected");
    }
  });
});

describe("cancellation and failure", () => {
  it("cancel ends any active state and is ignored in terminal states", () => {
    for (const state of ALL_STATES) {
      const result = transition(state, { type: "cancel", flowId: FLOW_ID });
      if (isActiveFlowState(state)) {
        expect(result.kind === "applied").toBe(true);
        expect(result.state.status).toBe("cancelled");
      } else {
        expect(result.kind === "applied").toBe(false);
      }
    }
  });

  it("fail carries the reason and message and only fires while active", () => {
    for (const state of ALL_STATES) {
      const result = transition(state, {
        type: "fail",
        flowId: FLOW_ID,
        reason: "token_invalid",
        message: "bad token",
      });
      if (isActiveFlowState(state)) {
        expect(result.kind === "applied").toBe(true);
        expect(result.state).toMatchObject({
          status: "failed",
          reason: "token_invalid",
          message: "bad token",
        });
      } else {
        expect(result.kind === "applied").toBe(false);
      }
    }
  });

  it("acknowledge only resets terminal states", () => {
    for (const state of ALL_STATES) {
      if (state.status === "disconnected") continue;
      const result = transition(state, {
        type: "acknowledge",
        flowId: FLOW_ID,
      });
      expect(result.kind === "applied").toBe(isTerminalFlowState(state));
      if (result.kind === "applied") {
        expect(result.state).toEqual({ status: "disconnected" });
      }
    }
  });
});

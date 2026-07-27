import { describe, expect, it } from "vitest";
import type {
  ConnectionFlowEvent,
  ConnectionFlowInvocationRef,
  ConnectionFlowState,
} from "./state";
import { transition } from "./transition";

const REF: ConnectionFlowInvocationRef = {
  kind: "connection-flow",
  entityKey: "neon",
  operationId: "one",
};
const STALE_REF: ConnectionFlowInvocationRef = {
  ...REF,
  operationId: "stale",
};
const WRONG_ENTITY_REF = {
  ...REF,
  entityKey: "supabase",
} as ConnectionFlowInvocationRef;
const STATE_KINDS = [
  "disconnected",
  "starting",
  "awaiting-return",
  "exchanging-token",
  "connected",
  "failed",
  "cancelled",
] as const satisfies readonly ConnectionFlowState["status"][];
const ALL_STATES: ConnectionFlowState[] = [
  { status: "disconnected", revision: 0 },
  { status: "starting", revision: 1, invocationRef: REF, provider: "neon" },
  {
    status: "awaiting-return",
    revision: 2,
    invocationRef: REF,
    provider: "neon",
  },
  {
    status: "exchanging-token",
    revision: 3,
    invocationRef: REF,
    provider: "neon",
  },
  {
    status: "connected",
    revision: 4,
    invocationRef: REF,
    provider: "neon",
  },
  {
    status: "failed",
    revision: 4,
    invocationRef: REF,
    provider: "neon",
    reason: "timeout",
  },
  {
    status: "cancelled",
    revision: 4,
    invocationRef: REF,
    provider: "neon",
  },
];

function eventsWithRef(
  invocationRef: ConnectionFlowInvocationRef,
): ConnectionFlowEvent[] {
  return [
    { type: "start", invocationRef, provider: invocationRef.entityKey },
    { type: "prepared", invocationRef },
    { type: "return-received", invocationRef },
    { type: "token-exchanged", invocationRef },
    { type: "timeout", invocationRef },
    { type: "cancel", invocationRef },
    { type: "fail", invocationRef, reason: "network", message: "boom" },
    { type: "acknowledge", invocationRef },
  ];
}

describe("connection flow transition", () => {
  it("throws when an impossible state reaches the exhaustiveness helper", () => {
    expect(() =>
      transition({ status: "future" } as unknown as ConnectionFlowState, {
        type: "start",
        invocationRef: REF,
        provider: "neon",
      }),
    ).toThrow(/Unreachable connection-flow state/);
  });

  it("covers every state x event combination with revision invariants", () => {
    const events = [
      ...eventsWithRef(REF),
      ...eventsWithRef(STALE_REF),
      ...eventsWithRef(WRONG_ENTITY_REF),
    ];
    expect(new Set(ALL_STATES.map((state) => state.status))).toEqual(
      new Set(STATE_KINDS),
    );
    expect(new Set(eventsWithRef(REF).map((event) => event.type)).size).toBe(8);

    for (const state of ALL_STATES) {
      for (const event of events) {
        const result = transition(state, event);
        if (result.kind === "applied") {
          expect(result.state).not.toBe(state);
          expect(result.state.revision).toBe(state.revision + 1);
          expect(result.commands).toEqual([]);
        } else {
          expect(result.state).toBe(state);
          expect(result.reason).toBeTruthy();
        }
      }
    }
  });

  it("advances the revision and typed ref through the happy path", () => {
    let state: ConnectionFlowState = {
      status: "disconnected",
      revision: 0,
    };
    const apply = (event: ConnectionFlowEvent) => {
      const result = transition(state, event);
      expect(result.kind).toBe("applied");
      state = result.state;
    };

    apply({ type: "start", invocationRef: REF, provider: "neon" });
    apply({ type: "prepared", invocationRef: REF });
    apply({ type: "return-received", invocationRef: REF });
    apply({ type: "token-exchanged", invocationRef: REF });
    expect(state).toMatchObject({
      status: "connected",
      revision: 4,
      invocationRef: REF,
    });
    apply({ type: "acknowledge", invocationRef: REF });
    expect(state).toEqual({ status: "disconnected", revision: 5 });
  });

  it("ignores every correlated event with any mismatched ref component", () => {
    for (const state of ALL_STATES) {
      if (state.status === "disconnected") continue;
      for (const staleRef of [STALE_REF, WRONG_ENTITY_REF]) {
        for (const event of eventsWithRef(staleRef)) {
          if (event.type === "start") continue;
          expect(transition(state, event)).toEqual({
            kind: "ignored",
            state,
            reason: "invocation-mismatch",
          });
        }
      }
    }
  });

  it("makes timeout and return mutually exclusive", () => {
    const awaiting: ConnectionFlowState = {
      status: "awaiting-return",
      revision: 2,
      invocationRef: REF,
      provider: "neon",
    };
    const returned = transition(awaiting, {
      type: "return-received",
      invocationRef: REF,
    });
    expect(returned.kind).toBe("applied");
    expect(
      transition(returned.state, { type: "timeout", invocationRef: REF }),
    ).toMatchObject({
      kind: "ignored",
      reason: "invalid-in-current-state",
    });
  });
});

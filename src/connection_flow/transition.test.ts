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

describe("connection flow transition", () => {
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

  it("ignores stale refs across every correlated event", () => {
    const state: ConnectionFlowState = {
      status: "awaiting-return",
      revision: 2,
      invocationRef: REF,
      provider: "neon",
    };
    const events: ConnectionFlowEvent[] = [
      { type: "prepared", invocationRef: STALE_REF },
      { type: "return-received", invocationRef: STALE_REF },
      { type: "token-exchanged", invocationRef: STALE_REF },
      { type: "timeout", invocationRef: STALE_REF },
      { type: "cancel", invocationRef: STALE_REF },
      {
        type: "fail",
        invocationRef: STALE_REF,
        reason: "network",
      },
      { type: "acknowledge", invocationRef: STALE_REF },
    ];
    for (const event of events) {
      expect(transition(state, event)).toEqual({
        kind: "ignored",
        state,
        reason: "invocation-mismatch",
      });
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

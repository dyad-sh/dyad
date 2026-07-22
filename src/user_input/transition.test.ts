import { describe, expect, it } from "vitest";
import {
  assertReferenceStability,
  exploreReachableStates,
} from "../state_machines/testing";
import type {
  UserInputDescriptor,
  UserInputEvent,
  UserInputState,
} from "./state";
import { transition } from "./transition";

const descriptor: UserInputDescriptor = {
  kind: "mcp-consent",
  requestId: "mcp-consent:1",
  chatId: 10,
  deadlineAt: 300_000,
  serverId: 2,
  serverName: "server",
  toolName: "read",
  classifier: "racing",
};
const request: UserInputEvent = {
  type: "requested",
  descriptor,
  deadlineMs: 300_000,
};
const raceEvents: UserInputEvent[] = [
  {
    type: "human-decided",
    requestId: descriptor.requestId,
    response: { kind: "mcp-consent", decision: "accept-once" },
  },
  {
    type: "classifier-decided",
    requestId: descriptor.requestId,
    approved: true,
  },
  { type: "timed-out", requestId: descriptor.requestId },
  { type: "chat-swept", chatId: descriptor.chatId },
];

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [values.slice()];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(
      (rest) => [value, ...rest],
    ),
  );
}

describe("user-input transition", () => {
  it("is total and reference-stable over every reachable state and event", () => {
    const events: UserInputEvent[] = [
      request,
      ...raceEvents,
      {
        type: "classifier-decided",
        requestId: descriptor.requestId,
        approved: false,
      },
      { type: "stream-finished", chatId: descriptor.chatId },
      { type: "follow-up-dispatched", requestId: descriptor.requestId },
    ];
    const states = exploreReachableStates({
      initialState: { status: "idle" } as UserInputState,
      events,
      transition,
      stateKey: JSON.stringify,
    });
    expect(states.length).toBeGreaterThan(3);

    for (const state of states) {
      for (const event of events) {
        const result = transition(state, event);
        expect(result).toBeDefined();
        assertReferenceStability(
          state,
          result,
          (left, right) => JSON.stringify(left) === JSON.stringify(right),
        );
      }
    }
  });

  it("makes every terminal ordering first-applied-wins", () => {
    for (const ordering of permutations(raceEvents)) {
      let state = transition({ status: "idle" }, request).state;
      const first = transition(state, ordering[0]);
      expect(first.ignoredReason).toBeUndefined();
      state = first.state;
      expect(state.status).toBe("settled");

      for (const loser of ordering.slice(1)) {
        const result = transition(state, loser);
        expect(result.ignoredReason).toBe("already-settled");
        expect(result.state).toBe(state);
      }
    }
  });
});

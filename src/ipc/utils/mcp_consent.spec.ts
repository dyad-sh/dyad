import { describe, expect, it } from "vitest";
import { commandsOf, ignoreReasonOf } from "@/state_machines/testing";
import type {
  UserInputDescriptor,
  UserInputState,
} from "../../user_input/state";
import { transition } from "../../user_input/transition";

const descriptor: UserInputDescriptor = {
  kind: "mcp-consent",
  requestId: "mcp-consent:1",
  chatId: 7,
  deadlineAt: 300_000,
  serverId: 1,
  serverName: "srv",
  toolName: "tool",
  classifier: "racing",
};

function awaiting(): UserInputState {
  return {
    status: "awaiting",
    descriptor,
    classifier: "racing",
  };
}

describe("MCP consent classifier transitions", () => {
  it("auto-approval wins structurally and a late decline is ignored", () => {
    const approved = transition(awaiting(), {
      type: "classifier-decided",
      requestId: descriptor.requestId,
      approved: true,
      reason: "safe",
    });
    expect(approved.state).toMatchObject({
      status: "settled",
      outcome: "classifier-approved",
    });

    const decline = transition(approved.state, {
      type: "human-decided",
      requestId: descriptor.requestId,
      response: { kind: "mcp-consent", decision: "decline" },
    });
    expect(ignoreReasonOf(decline)).toBe("already-settled");
    expect(decline.state).toBe(approved.state);
  });

  it("a human decision wins when it arrives before classification", () => {
    const human = transition(awaiting(), {
      type: "human-decided",
      requestId: descriptor.requestId,
      response: { kind: "mcp-consent", decision: "accept-once" },
    });
    expect(human.state).toMatchObject({ status: "settled", outcome: "human" });

    const classifier = transition(human.state, {
      type: "classifier-decided",
      requestId: descriptor.requestId,
      approved: true,
    });
    expect(ignoreReasonOf(classifier)).toBe("already-settled");
  });

  it("fails closed to review when classification does not approve", () => {
    const result = transition(awaiting(), {
      type: "classifier-decided",
      requestId: descriptor.requestId,
      approved: false,
      reason: "risky",
    });
    expect(result.state).toMatchObject({
      status: "awaiting",
      classifier: "review",
    });
    expect(commandsOf(result)).toContainEqual(
      expect.objectContaining({
        type: "broadcast-classified",
        reason: "risky",
      }),
    );
  });
});

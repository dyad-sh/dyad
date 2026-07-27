import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { transitionPlanHandoffHost } from "./definition";
import type { PlanHandoffIntent } from "./transport";

function intent(handoffId = "handoff-1"): PlanHandoffIntent {
  const plan = { title: "Ship it", content: "Implementation steps" };
  const hash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  return {
    schemaVersion: 1,
    handoffId,
    sourceChatId: 4,
    appId: 2,
    acceptInNewChat: true,
    planId: "chat-4",
    planVersion: hash,
    planHash: hash,
    plan,
  };
}

describe("main plan handoff transition", () => {
  it("captures one immutable handoff and starts its durable runner", () => {
    const accepted = transitionPlanHandoffHost(
      {
        intent: null,
        targetChatId: null,
        phase: "idle",
        failure: null,
      },
      { type: "ACCEPT", intent: intent() },
    );

    expect(accepted).toMatchObject({
      kind: "applied",
      state: { phase: "accepted", intent: { handoffId: "handoff-1" } },
      commands: [{ type: "run-handoff" }],
    });
  });

  it("ignores checkpoints from a superseded handoff", () => {
    const state = {
      intent: intent(),
      targetChatId: null,
      phase: "persisting" as const,
      failure: null,
    };
    const result = transitionPlanHandoffHost(state, {
      type: "CHECKPOINT",
      handoffId: "old-handoff",
      phase: "started",
    });

    expect(result).toEqual({
      kind: "ignored",
      state,
      reason: "stale-handoff",
    });
  });
});

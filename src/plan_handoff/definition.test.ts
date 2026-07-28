import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { planHandoffDefinition } from "./definition";
import { transitionPlanHandoffHost } from "./host_transition";
import {
  PlanHandoffIntentSchema,
  serializePlanDocument,
  type PlanHandoffIntent,
} from "./transport";
import { beginChatActorDeletion } from "@/ipc/services/chat_actor_deletion_fence";

function intent(handoffId = "handoff-1"): PlanHandoffIntent {
  const plan = { title: "Ship it", content: "Implementation steps" };
  const hash = createHash("sha256")
    .update(serializePlanDocument(plan))
    .digest("hex");
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
      commands: [{ type: "begin-handoff" }],
    });
  });

  it("waits for the accepted-plan display interval before running", () => {
    const accepted = transitionPlanHandoffHost(
      {
        intent: null,
        targetChatId: null,
        phase: "idle",
        failure: null,
      },
      { type: "ACCEPT", intent: intent() },
    );
    expect(accepted.kind).toBe("applied");
    if (accepted.kind !== "applied") return;

    expect(
      transitionPlanHandoffHost(accepted.state, {
        type: "DISPLAY_ELAPSED",
        handoffId: "handoff-1",
      }),
    ).toMatchObject({
      kind: "applied",
      state: { phase: "accepted" },
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

  it("does not replace an active handoff when another window accepts", () => {
    const state = {
      intent: intent("handoff-1"),
      targetChatId: null,
      phase: "persisting" as const,
      failure: null,
    };

    expect(
      transitionPlanHandoffHost(state, {
        type: "ACCEPT",
        intent: intent("handoff-2"),
      }),
    ).toEqual({
      kind: "ignored",
      state,
      reason: "already-running",
    });
  });

  it("keeps the plan hash stable across schema key reordering", () => {
    const plan = {
      content: "Implementation steps",
      title: "Ship it",
      summary: "Canonical",
    };
    const before = serializePlanDocument(plan);
    const after = serializePlanDocument(
      PlanHandoffIntentSchema.shape.plan.parse(plan),
    );

    expect(after).toBe(before);
  });

  it("starts idle instead of hydrating handoffs across app restarts", () => {
    expect(planHandoffDefinition.initialState({ sourceChatId: 4 })).toEqual({
      intent: null,
      targetChatId: null,
      phase: "idle",
      failure: null,
    });
  });

  it("refuses actor construction while the source chat is being deleted", () => {
    const releaseDeletion = beginChatActorDeletion(4);
    try {
      expect(() =>
        planHandoffDefinition.initialState({ sourceChatId: 4 }),
      ).toThrowError(expect.objectContaining({ kind: "precondition" }));
    } finally {
      releaseDeletion();
    }
  });
});

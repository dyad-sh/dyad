import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  isMatchingPlanHandoffReplay,
  planHandoffDefinition,
  transitionPlanHandoffHost,
} from "./definition";
import type { PlanHandoffIntent } from "./transport";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";
import { apps, chats, planHandoffs } from "@/db/schema";

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
  let harness: HandlerTestHarness | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
  });

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

  it("binds replay identity to the new-chat choice", () => {
    const original = intent();

    expect(
      isMatchingPlanHandoffReplay(
        {
          sourceChatId: original.sourceChatId,
          planVersion: original.planVersion,
          acceptInNewChat: original.acceptInNewChat,
        },
        { ...original, acceptInNewChat: false },
      ),
    ).toBe(false);
  });

  it("hydrates tied handoffs deterministically", () => {
    harness = setupHandlerTestHarness();
    const appId = Number(
      harness.db
        .insert(apps)
        .values({ name: "plan-app", path: "plan-app" })
        .run().lastInsertRowid,
    );
    const sourceChatId = Number(
      harness.db.insert(chats).values({ appId }).run().lastInsertRowid,
    );
    const timestamp = new Date("2026-01-01T00:00:00Z");
    for (const handoffId of ["handoff-a", "handoff-z"]) {
      const persisted = {
        ...intent(handoffId),
        sourceChatId,
        appId,
      };
      harness.db
        .insert(planHandoffs)
        .values({
          handoffId,
          sourceChatId,
          appId,
          planId: persisted.planId,
          planVersion: persisted.planVersion,
          planJson: JSON.stringify(persisted),
          acceptInNewChat: persisted.acceptInNewChat,
          phase: handoffId === "handoff-z" ? "started" : "failed",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }

    expect(planHandoffDefinition.initialState({ sourceChatId })).toMatchObject({
      intent: { handoffId: "handoff-z" },
      phase: "started",
    });
  });
});

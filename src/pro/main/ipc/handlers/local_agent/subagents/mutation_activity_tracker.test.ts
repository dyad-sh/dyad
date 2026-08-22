import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeMutationActor,
  createMutationActivityOwner,
  describeTurnActivity,
  endTurnFinalization,
  reserveMutationActivity,
  tryBeginTurnFinalization,
  validateMutationScope,
  waitForMutationActorDrain,
  withTrackedMutation,
} from "./mutation_activity_tracker";

function owner(turnId: string, actorRunId: string, chatId = 1) {
  return createMutationActivityOwner({
    appId: 7,
    chatId,
    turnId,
    actorRunId,
  });
}

const turnIds = new Set<string>();
function trackedOwner(turnId: string, actorRunId: string, chatId = 1) {
  turnIds.add(turnId);
  return owner(turnId, actorRunId, chatId);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const turnId of turnIds) endTurnFinalization(turnId);
  turnIds.clear();
});

describe("mutation activity tracker", () => {
  it("allows actors from different turns and chats to mutate concurrently", () => {
    const a = reserveMutationActivity(trackedOwner("turn-a", "actor-a"));
    const b = reserveMutationActivity(trackedOwner("turn-b", "actor-b", 2));

    expect(describeTurnActivity("turn-a")).toContain("1 active operation");
    expect(describeTurnActivity("turn-b")).toContain("1 active operation");
    a.settle();
    b.settle();
  });

  it("joins every parallel token owned by a turn before sealing", () => {
    const root = trackedOwner("turn", "root");
    const first = reserveMutationActivity(root);
    const second = reserveMutationActivity(root);

    expect(tryBeginTurnFinalization("turn")).toBe(false);
    first.settle();
    expect(tryBeginTurnFinalization("turn")).toBe(false);
    second.settle();
    expect(tryBeginTurnFinalization("turn")).toBe(true);
    expect(() => reserveMutationActivity(root)).toThrow(/finalizing/);
  });

  it("seals an otherwise idle root turn", () => {
    trackedOwner("idle-turn", "root");
    expect(tryBeginTurnFinalization("idle-turn")).toBe(true);
  });

  it("closes and drains only the targeted actor generation", async () => {
    const firstOwner = trackedOwner("turn", "run-1");
    const secondOwner = trackedOwner("turn", "run-2");
    const first = reserveMutationActivity(firstOwner);
    const second = reserveMutationActivity(secondOwner);

    closeMutationActor(firstOwner.actorRunId);
    expect(() => reserveMutationActivity(firstOwner)).toThrow(/stopped/);
    const additionalSecond = reserveMutationActivity(secondOwner);
    const draining = waitForMutationActorDrain(firstOwner.actorRunId, 100);
    first.settle();
    expect(await draining).toBe(true);
    additionalSecond.settle();
    second.settle();
  });

  it("can continue waiting after a bounded drain attempt times out", async () => {
    const activityOwner = trackedOwner("turn", "run-1");
    const activity = reserveMutationActivity(activityOwner);
    closeMutationActor(activityOwner.actorRunId);

    expect(await waitForMutationActorDrain(activityOwner.actorRunId, 0)).toBe(
      false,
    );
    const eventualDrain = waitForMutationActorDrain(activityOwner.actorRunId);
    activity.settle();
    expect(await eventualDrain).toBe(true);
  });

  it("makes stale and repeated handle settlement harmless", () => {
    const firstOwner = trackedOwner("turn", "run-1");
    const first = reserveMutationActivity(firstOwner);
    first.settle();
    first.settle();

    const successor = reserveMutationActivity(trackedOwner("turn", "run-2"));
    first.settle();
    expect(tryBeginTurnFinalization("turn")).toBe(false);
    successor.settle();
    expect(tryBeginTurnFinalization("turn")).toBe(true);
  });

  it.each(["C:\\outside", "C:outside", "D:/outside"])(
    "rejects Windows drive scope %s on every host OS",
    (scope) => {
      expect(() => validateMutationScope([scope])).toThrow(/relative paths/);
    },
  );

  it("rejects a missing writable owner outside the legacy test-fixture path", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(
      withTrackedMutation({ mutationActivityOwner: undefined }, async () =>
        Promise.resolve("unexpected"),
      ),
    ).rejects.toThrow(/missing its mutation owner/);
  });
});

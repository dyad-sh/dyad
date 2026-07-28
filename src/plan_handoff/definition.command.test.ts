import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createChatForApp: vi.fn(async () => 99),
  savePlanToDisk: vi.fn(async () => "accepted-plan"),
  routePlanHandoffPresentation: vi.fn(),
  publishChatInvalidations: vi.fn(),
  waitForChatActorIdle: vi.fn(async () => undefined),
  dispatchPlanImplementationTurn: vi.fn(async () => undefined),
  deleteOwnedChatAfterSettlingActors: vi.fn(async () => undefined),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => ({ path: "/tmp/app" }),
        }),
      }),
    }),
  },
}));
vi.mock("@/ipc/utils/chat_creation_utils", () => ({
  createChatForApp: mocks.createChatForApp,
}));
vi.mock("@/ipc/handlers/planPersistence", () => ({
  savePlanToDisk: mocks.savePlanToDisk,
}));
vi.mock("@/ipc/services/chat_actor_platform", () => ({
  publishChatInvalidations: mocks.publishChatInvalidations,
  routePlanHandoffPresentation: mocks.routePlanHandoffPresentation,
}));
vi.mock("@/ipc/services/chat_actor_service", () => ({
  deleteOwnedChatAfterSettlingActors: mocks.deleteOwnedChatAfterSettlingActors,
  dispatchPlanImplementationTurn: mocks.dispatchPlanImplementationTurn,
  waitForChatActorIdle: mocks.waitForChatActorIdle,
}));
vi.mock("@/ipc/services/chat_actor_deletion_fence", () => ({
  assertChatActorAdmissionOpen: vi.fn(),
}));
vi.mock("@/paths/paths", () => ({
  getDyadAppPath: (path: string) => path,
}));

import { planHandoffDefinition } from "./definition";
import { serializePlanDocument, type PlanHandoffIntent } from "./transport";
import type { PlanHandoffHostEvent } from "./host_state";

function intent(): PlanHandoffIntent {
  const plan = { title: "Ship it", content: "Implement it" };
  const planHash = createHash("sha256")
    .update(serializePlanDocument(plan))
    .digest("hex");
  return {
    schemaVersion: 1,
    handoffId: "handoff-1",
    sourceChatId: 7,
    appId: 3,
    acceptInNewChat: true,
    planId: "chat-7",
    planVersion: planHash,
    planHash,
    plan,
    originWindowSessionId: "window-session",
  };
}

function commandRunner() {
  const send = vi.fn();
  const removeTask = vi.fn();
  const context = {
    key: { sourceChatId: 7 },
    send,
    getSnapshot: () => ({
      intent: intent(),
      targetChatId: null,
      phase: "accepted" as const,
      failure: null,
    }),
    timers: {
      replace: vi.fn(),
    },
    tasks: {
      replace: vi.fn(),
      remove: removeTask,
    },
  } as unknown as Parameters<
    typeof planHandoffDefinition.createCommandRunner
  >[0];
  return {
    runner: planHandoffDefinition.createCommandRunner(context),
    removeTask,
  };
}

describe("plan handoff command ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createChatForApp.mockResolvedValue(99);
    mocks.savePlanToDisk.mockResolvedValue("accepted-plan");
    mocks.waitForChatActorIdle.mockResolvedValue(undefined);
    mocks.dispatchPlanImplementationTurn.mockResolvedValue(undefined);
    mocks.deleteOwnedChatAfterSettlingActors.mockResolvedValue(undefined);
  });

  it("compensates a new target chat when implementation admission fails", async () => {
    const failure = new Error("implementation admission failed");
    mocks.dispatchPlanImplementationTurn.mockRejectedValueOnce(failure);
    const { runner, removeTask } = commandRunner();
    const emit = vi.fn<(event: PlanHandoffHostEvent) => void>();

    await runner({ type: "run-handoff", intent: intent() }, emit);

    expect(mocks.deleteOwnedChatAfterSettlingActors).toHaveBeenCalledWith(99);
    expect(emit).toHaveBeenCalledWith({
      type: "FAILED",
      handoffId: "handoff-1",
      error: failure.message,
    });
    expect(removeTask).toHaveBeenCalledWith("handoff:handoff-1");
  });

  it("releases ownership after implementation admission succeeds", async () => {
    const { runner } = commandRunner();
    const emit = vi.fn<(event: PlanHandoffHostEvent) => void>();

    await runner({ type: "run-handoff", intent: intent() }, emit);

    expect(mocks.deleteOwnedChatAfterSettlingActors).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({
      type: "CHECKPOINT",
      handoffId: "handoff-1",
      phase: "started",
      targetChatId: 99,
    });
  });
});

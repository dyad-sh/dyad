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
  setChatMode: vi.fn(),
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
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          run: () => mocks.setChatMode(values),
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

    expect(mocks.savePlanToDisk).toHaveBeenCalledOnce();
    expect(mocks.savePlanToDisk).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft" }),
    );
    expect(mocks.deleteOwnedChatAfterSettlingActors).toHaveBeenCalledWith(99);
    expect(mocks.routePlanHandoffPresentation).not.toHaveBeenCalled();
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

    expect(mocks.savePlanToDisk).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: "draft" }),
    );
    expect(mocks.savePlanToDisk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: "accepted" }),
    );
    expect(
      mocks.dispatchPlanImplementationTurn.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.savePlanToDisk.mock.invocationCallOrder[1]);
    expect(mocks.deleteOwnedChatAfterSettlingActors).not.toHaveBeenCalled();
    expect(mocks.routePlanHandoffPresentation).toHaveBeenCalledWith({
      handoffId: "handoff-1",
      sourceChatId: 7,
      targetChatId: 99,
      appId: 3,
      originWindowSessionId: "window-session",
    });
    expect(
      mocks.dispatchPlanImplementationTurn.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.routePlanHandoffPresentation.mock.invocationCallOrder[0],
    );
    expect(emit).toHaveBeenCalledWith({
      type: "CHECKPOINT",
      handoffId: "handoff-1",
      phase: "started",
      targetChatId: 99,
    });
  });

  it("does not offer a retry when metadata fails after admission", async () => {
    const metadataFailure = new Error("accepted plan write failed");
    mocks.savePlanToDisk
      .mockResolvedValueOnce("draft-plan")
      .mockRejectedValueOnce(metadataFailure);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { runner } = commandRunner();
    const emit = vi.fn<(event: PlanHandoffHostEvent) => void>();

    await runner({ type: "run-handoff", intent: intent() }, emit);

    expect(emit).toHaveBeenCalledWith({
      type: "CHECKPOINT",
      handoffId: "handoff-1",
      phase: "started",
      targetChatId: 99,
    });
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "FAILED" }),
    );
    expect(mocks.deleteOwnedChatAfterSettlingActors).not.toHaveBeenCalled();
    expect(mocks.routePlanHandoffPresentation).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[plan-handoff] Plan status update failed after implementation admission",
      { error: metadataFailure },
    );

    consoleError.mockRestore();
  });

  it("changes the current chat mode only after implementation admission", async () => {
    const currentChatIntent = {
      ...intent(),
      acceptInNewChat: false,
    };
    const failure = new Error("implementation admission failed");
    mocks.dispatchPlanImplementationTurn.mockRejectedValueOnce(failure);
    const { runner } = commandRunner();
    const emit = vi.fn<(event: PlanHandoffHostEvent) => void>();

    await runner({ type: "run-handoff", intent: currentChatIntent }, emit);

    expect(mocks.setChatMode).not.toHaveBeenCalled();

    mocks.dispatchPlanImplementationTurn.mockResolvedValueOnce(undefined);
    await runner({ type: "run-handoff", intent: currentChatIntent }, emit);

    expect(mocks.setChatMode).toHaveBeenCalledWith({
      chatMode: "local-agent",
    });
    expect(
      mocks.dispatchPlanImplementationTurn.mock.invocationCallOrder[1],
    ).toBeLessThan(mocks.setChatMode.mock.invocationCallOrder[0]);
  });
});

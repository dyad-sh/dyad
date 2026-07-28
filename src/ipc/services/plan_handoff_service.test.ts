import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn<() => { settled: Promise<unknown> }>(() => ({
    settled: Promise.resolve({ kind: "applied", state: {} }),
  })),
  readPlanFromDisk: vi.fn(),
  localRef: vi.fn(),
}));

vi.mock("@/ipc/services/distributed_machine_actor_host", () => ({
  remoteMachineHost: {
    localRef: mocks.localRef,
  },
}));
vi.mock("@/plan_handoff/definition", () => ({
  planHandoffDefinition: { id: "plan_handoff" },
}));
vi.mock("@/state_machines/clock", () => ({
  uuidIdSource: { next: () => "handoff-from-main" },
}));
vi.mock("@/window_infrastructure/main/window_registry", () => ({
  windowRegistry: {
    sessionForWebContents: () => "window-session",
  },
}));
vi.mock("@/ipc/handlers/planPersistence", () => ({
  readPlanFromDisk: mocks.readPlanFromDisk,
}));

import {
  rememberPlanDraft,
  startPlanHandoffFromMain,
} from "./plan_handoff_service";
import { beginChatActorDeletion } from "./chat_actor_deletion_fence";

describe("main plan handoff service", () => {
  beforeEach(() => {
    mocks.enqueue.mockClear();
    mocks.readPlanFromDisk.mockReset();
    mocks.localRef.mockReset();
    mocks.localRef.mockReturnValue({ enqueue: mocks.enqueue });
  });

  it("admits the remembered plan without a renderer callback", async () => {
    rememberPlanDraft(7, {
      title: "Main-owned plan",
      summary: "Keep running",
      content: "Implement it",
    });

    await expect(
      startPlanHandoffFromMain({
        sourceChatId: 7,
        appId: 3,
        appPath: "/tmp/app",
        acceptInNewChat: true,
        senderWebContentsId: 12,
      }),
    ).resolves.toBe("handoff-from-main");

    expect(mocks.readPlanFromDisk).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: "ACCEPT",
      intent: expect.objectContaining({
        handoffId: "handoff-from-main",
        sourceChatId: 7,
        appId: 3,
        acceptInNewChat: true,
        originWindowSessionId: "window-session",
        plan: {
          title: "Main-owned plan",
          summary: "Keep running",
          content: "Implement it",
        },
      }),
    });
  });

  it("rechecks deletion admission after an awaited plan read", async () => {
    let finishRead!: (plan: { title: string; content: string }) => void;
    mocks.readPlanFromDisk.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    const handoff = startPlanHandoffFromMain({
      sourceChatId: 8,
      appId: 3,
      appPath: "/tmp/app",
      acceptInNewChat: false,
      senderWebContentsId: 12,
    });
    await Promise.resolve();
    const releaseDeletion = beginChatActorDeletion(8);
    finishRead({ title: "Late plan", content: "Do not admit" });

    await expect(handoff).rejects.toMatchObject({ kind: "precondition" });
    expect(mocks.localRef).not.toHaveBeenCalled();
    releaseDeletion();
  });

  it("preserves the original actor admission failure", async () => {
    const failure = new Error("transition exploded");
    rememberPlanDraft(20, { title: "Plan", content: "Implement it" });
    mocks.enqueue.mockReturnValueOnce({
      settled: Promise.resolve({
        kind: "failed",
        stage: "transition",
        error: failure,
      }),
    });

    await expect(
      startPlanHandoffFromMain({
        sourceChatId: 20,
        appId: 3,
        appPath: "/tmp/app",
        acceptInNewChat: true,
        senderWebContentsId: 12,
      }),
    ).rejects.toBe(failure);
  });

  it("classifies disposed admission as a precondition failure", async () => {
    rememberPlanDraft(21, { title: "Plan", content: "Implement it" });
    mocks.enqueue.mockReturnValueOnce({
      settled: Promise.resolve({ kind: "disposed" }),
    });

    await expect(
      startPlanHandoffFromMain({
        sourceChatId: 21,
        appId: 3,
        appPath: "/tmp/app",
        acceptInNewChat: true,
        senderWebContentsId: 12,
      }),
    ).rejects.toMatchObject({ kind: "precondition" });
  });

  it("classifies an already-running handoff as a conflict", async () => {
    rememberPlanDraft(22, { title: "Plan", content: "Implement it" });
    mocks.enqueue.mockReturnValueOnce({
      settled: Promise.resolve({
        kind: "ignored",
        state: {},
        reason: "already-running",
      }),
    });

    await expect(
      startPlanHandoffFromMain({
        sourceChatId: 22,
        appId: 3,
        appPath: "/tmp/app",
        acceptInNewChat: true,
        senderWebContentsId: 12,
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
  });
});

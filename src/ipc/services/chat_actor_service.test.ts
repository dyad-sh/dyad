import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = vi.hoisted(() => {
  let phase = "streaming";
  let settleDuringSubscribe = true;
  let lastCompletion: { intentId: string; outcome: string } | null = null;
  let listener: (() => void) | undefined;
  return {
    reset: () => {
      phase = "streaming";
      settleDuringSubscribe = true;
      lastCompletion = null;
      listener = undefined;
    },
    setPhase: (nextPhase: string) => {
      phase = nextPhase;
    },
    completeOnSend: (intentId: string) => {
      settleDuringSubscribe = false;
      actor.send.mockImplementationOnce(() => {
        lastCompletion = { intentId, outcome: "errored" };
        listener?.();
      });
    },
    getSnapshot: vi.fn(
      (): {
        phase: string;
        active: {
          invocationRef: {
            kind: "chat-stream";
            entityKey: number;
            operationId: string;
          };
        } | null;
        lastAcceptance: null;
        lastCompletion: { intentId: string; outcome: string } | null;
        stopPolicyVersion: number;
      } => ({
        phase,
        active: null,
        lastAcceptance: null,
        lastCompletion,
        stopPolicyVersion: 3,
      }),
    ),
    subscribe: vi.fn((nextListener: () => void) => {
      listener = nextListener;
      // Reproduce settlement in the read-to-subscribe gap without delivering
      // a notification to the newly registered listener.
      if (settleDuringSubscribe) phase = "idle";
      return vi.fn();
    }),
    send: vi.fn(),
  };
});

const host = vi.hoisted(() => ({
  peek: vi.fn<() => typeof actor | undefined>(() => actor),
  localRef: vi.fn(() => actor),
  entityDeleted: vi.fn(async () => undefined),
}));

const cleanup = vi.hoisted(() => ({
  settleChat: vi.fn(async () => undefined),
  deleteWhere: vi.fn(async () => undefined),
  publish: vi.fn(),
  findChats: vi.fn(async () => [] as Array<{ id: number }>),
  findChat: vi.fn(() => ({ id: 7 }) as { id: number } | undefined),
}));

const persistence = vi.hoisted(() => ({
  getIntentAcceptance: vi.fn<
    () => "queued" | "message-accepted" | "rejected" | undefined
  >(() => undefined),
}));
const subagents = vi.hoisted(() => ({
  settle: vi.fn(async () => vi.fn()),
}));
const workspaces = vi.hoisted(() => ({
  onChatDeleting: vi.fn(async (_chatId: number) => undefined),
}));

vi.mock("./chat_workspace_service", () => ({
  chatWorkspaceService: { onChatDeleting: workspaces.onChatDeleting },
}));

vi.mock("@/ipc/services/distributed_machine_actor_host", () => ({
  remoteMachineHost: host,
}));

vi.mock("@/chat_stream/definition", () => ({
  chatStreamDefinition: { id: "chat_stream" },
}));
vi.mock("@/user_input/main", () => ({
  userInputRegistry: { settleChat: cleanup.settleChat },
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ get: cleanup.findChat }),
      }),
    }),
    delete: () => ({ where: cleanup.deleteWhere }),
    query: {
      chats: {
        findMany: cleanup.findChats,
      },
    },
  },
}));
vi.mock("@/db/schema", () => ({
  chats: { id: "id" },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: vi.fn(() => true),
}));
vi.mock("@/window_infrastructure/main/entity_disposal_bus", () => ({
  entityDisposalBus: { publish: cleanup.publish },
}));
vi.mock("@/chat_stream/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat_stream/persistence")>()),
  getIntentAcceptance: persistence.getIntentAcceptance,
}));
vi.mock(
  "@/pro/main/ipc/handlers/local_agent/subagents/subagent_manager",
  () => ({
    blockSubagentAdmissionsForChat: vi.fn(() => vi.fn()),
    settleSubagentsForChatDeletion: subagents.settle,
  }),
);

import {
  beginAppChatActorMutation,
  deleteOwnedChatAfterSettlingActors,
  dispatchChatIntentAndWait,
  hasActiveAppChatActors,
  observeChatSubmissionStopPolicy,
  waitForAppChatActorsIdle,
  waitForChatActorIdle,
} from "./chat_actor_service";
import {
  assertChatActorAdmissionOpen,
  beginChatActorMutation,
} from "./chat_actor_deletion_fence";
import { assertAppChatCreationOpen } from "./app_chat_creation_fence";

describe("waitForChatActorIdle", () => {
  beforeEach(() => {
    actor.reset();
    actor.getSnapshot.mockClear();
    actor.subscribe.mockClear();
    actor.send.mockClear();
    actor.send.mockReset();
    host.peek.mockClear();
    host.peek.mockReturnValue(actor);
    host.localRef.mockClear();
    host.entityDeleted.mockClear();
    cleanup.settleChat.mockClear();
    cleanup.deleteWhere.mockClear();
    cleanup.publish.mockClear();
    cleanup.findChats.mockClear();
    cleanup.findChats.mockResolvedValue([]);
    cleanup.findChat.mockReset();
    cleanup.findChat.mockReturnValue({ id: 7 });
    persistence.getIntentAcceptance.mockReset();
    persistence.getIntentAcceptance.mockReturnValue(undefined);
    subagents.settle.mockClear();
  });

  it("observes a submission cutoff from the main-owned chat actor", () => {
    expect(observeChatSubmissionStopPolicy(7)).toBe(3);
    expect(host.localRef).toHaveBeenCalledOnce();
  });

  it("treats an absent actor as already idle without creating it", async () => {
    host.peek.mockReturnValueOnce(undefined);

    await expect(waitForChatActorIdle(7)).resolves.toBe(false);

    expect(host.peek).toHaveBeenCalledOnce();
    expect(host.localRef).not.toHaveBeenCalled();
  });

  it("rechecks the terminal phase after subscribing", async () => {
    await expect(waitForChatActorIdle(7)).resolves.toBe(false);
    expect(actor.subscribe).toHaveBeenCalledOnce();
    expect(actor.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("cancels an actor that is still admitting before waiting for idle", async () => {
    actor.getSnapshot.mockReturnValueOnce({
      phase: "admitting",
      active: {
        invocationRef: {
          kind: "chat-stream",
          entityKey: 7,
          operationId: "stream-7",
        },
      },
      lastAcceptance: null,
      lastCompletion: null,
      stopPolicyVersion: 0,
    });

    await expect(waitForChatActorIdle(7, { cancelActive: true })).resolves.toBe(
      true,
    );

    expect(actor.send).toHaveBeenCalledWith({
      type: "CANCEL",
      invocationRef: {
        kind: "chat-stream",
        entityKey: 7,
        operationId: "stream-7",
      },
    });
  });

  it("cancels and drains every existing actor for an app restore", async () => {
    cleanup.findChats.mockResolvedValue([{ id: 7 }, { id: 8 }]);

    await expect(
      waitForAppChatActorsIdle(3, { cancelActive: true }),
    ).resolves.toBe(false);

    expect(cleanup.findChats).toHaveBeenCalledOnce();
    expect(host.peek).toHaveBeenCalledTimes(2);
    expect(host.peek).toHaveBeenNthCalledWith(
      1,
      "chat_stream",
      expect.objectContaining({ chatId: 7 }),
    );
    expect(host.peek).toHaveBeenNthCalledWith(
      2,
      "chat_stream",
      expect.objectContaining({ chatId: 8 }),
    );
  });

  it.each(["admitting", "streaming", "cancelling", "finalizing"])(
    "treats the %s actor phase as active for repository recovery",
    async (phase) => {
      cleanup.findChats.mockResolvedValue([{ id: 7 }]);
      actor.setPhase(phase);

      await expect(hasActiveAppChatActors(3)).resolves.toBe(true);
    },
  );

  it("holds app creation and existing actor admission fences for a mutation", async () => {
    cleanup.findChats.mockResolvedValue([{ id: 7 }, { id: 8 }]);

    const release = await beginAppChatActorMutation(3);
    try {
      expect(() => assertAppChatCreationOpen(3)).toThrow();
      expect(() => assertChatActorAdmissionOpen(7)).toThrow();
      expect(() => assertChatActorAdmissionOpen(8)).toThrow();
    } finally {
      release();
    }

    expect(() => assertAppChatCreationOpen(3)).not.toThrow();
    expect(() => assertChatActorAdmissionOpen(7)).not.toThrow();
    expect(() => assertChatActorAdmissionOpen(8)).not.toThrow();
  });

  it("rejects a pre-acceptance intent when its terminal completion arrives", async () => {
    actor.completeOnSend("follow-up");

    await expect(
      dispatchChatIntentAndWait({
        schemaVersion: 1,
        intentId: "follow-up",
        payloadHash: "hash",
        chatId: 7,
        prompt: "continue",
        owner: {
          kind: "user-input-follow-up",
          requestId: "follow-up",
        },
      }),
    ).resolves.toBe("rejected");
    expect(actor.send).toHaveBeenCalledWith(
      expect.objectContaining({ observedStopPolicyVersion: 3 }),
    );
  });

  it("rejects main-owned dispatch while chat actor admission is fenced", async () => {
    const release = beginChatActorMutation(7);
    try {
      await expect(
        dispatchChatIntentAndWait({
          schemaVersion: 1,
          intentId: "blocked-follow-up",
          payloadHash: "hash",
          chatId: 7,
          prompt: "continue",
          owner: {
            kind: "user-input-follow-up",
            requestId: "blocked-follow-up",
          },
        }),
      ).rejects.toMatchObject({ kind: "precondition" });
    } finally {
      release();
    }

    expect(host.localRef).not.toHaveBeenCalled();
    expect(actor.send).not.toHaveBeenCalled();
  });

  it("settles a removed queued follow-up from authoritative rejection", async () => {
    const settled = dispatchChatIntentAndWait({
      schemaVersion: 1,
      intentId: "removed-follow-up",
      payloadHash: "hash",
      chatId: 7,
      prompt: "continue",
      owner: {
        kind: "user-input-follow-up",
        requestId: "removed-follow-up",
      },
    });

    persistence.getIntentAcceptance.mockReturnValue("rejected");
    actor.subscribe.mock.calls[0]?.[0]();

    await expect(settled).resolves.toBe("rejected");
  });

  it("treats a retained accepted completion as an accepted replay", async () => {
    actor.completeOnSend("completed-turn");
    persistence.getIntentAcceptance.mockReturnValue("message-accepted");

    await expect(
      dispatchChatIntentAndWait({
        schemaVersion: 1,
        intentId: "completed-turn",
        payloadHash: "hash",
        chatId: 7,
        prompt: "continue",
      }),
    ).resolves.toBe("accepted");
  });

  it("settles and disposes an owned chat before compensating its row", async () => {
    await deleteOwnedChatAfterSettlingActors(7);

    expect(subagents.settle).toHaveBeenCalledWith(7);
    expect(cleanup.settleChat).toHaveBeenCalledWith(7);
    expect(host.entityDeleted).toHaveBeenNthCalledWith(
      1,
      "plan_handoff",
      expect.objectContaining({ sourceChatId: 7 }),
    );
    expect(host.entityDeleted).toHaveBeenNthCalledWith(
      2,
      "chat_stream",
      expect.objectContaining({ chatId: 7 }),
    );
    expect(cleanup.deleteWhere).toHaveBeenCalledOnce();
    // The chat's isolated workspace is removed before its row cascades.
    expect(workspaces.onChatDeleting).toHaveBeenCalledWith(7);
    expect(workspaces.onChatDeleting.mock.invocationCallOrder[0]).toBeLessThan(
      cleanup.deleteWhere.mock.invocationCallOrder[0],
    );
    expect(cleanup.publish).toHaveBeenCalledWith({ kind: "chat", id: 7 });
  });
});

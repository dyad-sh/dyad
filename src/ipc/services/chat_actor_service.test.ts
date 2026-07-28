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
    completeOnSend: (intentId: string) => {
      settleDuringSubscribe = false;
      actor.send.mockImplementationOnce(() => {
        lastCompletion = { intentId, outcome: "errored" };
        listener?.();
      });
    },
    getSnapshot: vi.fn(() => ({
      phase,
      active: null,
      lastAcceptance: null,
      lastCompletion,
    })),
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
    delete: () => ({ where: cleanup.deleteWhere }),
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

import {
  deleteOwnedChatAfterSettlingActors,
  dispatchChatIntentAndWait,
  waitForChatActorIdle,
} from "./chat_actor_service";

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
  });

  it("treats an absent actor as already idle without creating it", async () => {
    host.peek.mockReturnValueOnce(undefined);

    await expect(waitForChatActorIdle(7)).resolves.toBeUndefined();

    expect(host.peek).toHaveBeenCalledOnce();
    expect(host.localRef).not.toHaveBeenCalled();
  });

  it("rechecks the terminal phase after subscribing", async () => {
    await expect(waitForChatActorIdle(7)).resolves.toBeUndefined();
    expect(actor.subscribe).toHaveBeenCalledOnce();
    expect(actor.getSnapshot).toHaveBeenCalledTimes(2);
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
  });

  it("settles and disposes an owned chat before compensating its row", async () => {
    await deleteOwnedChatAfterSettlingActors(7);

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
    expect(cleanup.publish).toHaveBeenCalledWith({ kind: "chat", id: 7 });
  });
});

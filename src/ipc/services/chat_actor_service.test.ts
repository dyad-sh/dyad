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

vi.mock("@/ipc/services/distributed_machine_actor_host", () => ({
  remoteMachineHost: {
    localRef: () => actor,
  },
}));

vi.mock("@/chat_stream/definition", () => ({
  chatStreamDefinition: {},
}));

import {
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
});

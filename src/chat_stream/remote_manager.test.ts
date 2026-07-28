import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import type {
  MachineAddress,
  MachineDispatchEnvelope,
  MachineSnapshotEnvelope,
} from "@/distributed_machines/remote_protocol";
import { createSequentialIdSource } from "@/state_machines/testing";
import { ChatStreamRemoteManager } from "./remote_manager";
import type { ChatStreamRemoteConnection } from "./remote_manager";
import { unavailableChatStreamSnapshot } from "./transport";

describe("ChatStreamRemoteManager", () => {
  it("handles a pending completion in the first bootstrap snapshot", async () => {
    let resolveBootstrap!: (snapshot: MachineSnapshotEnvelope) => void;
    const dispatch = vi.fn(
      async (envelope: MachineDispatchEnvelope) =>
        ({
          kind: "applied",
          actorInstanceId: "actor",
          revision: 1,
          transactionSequence: 1,
          messageId: envelope.messageId,
        }) as const,
    );
    const connection: ChatStreamRemoteConnection = {
      getStatus: () => "connected",
      onStatusChange: () => () => undefined,
      onSnapshot: () => () => undefined,
      onDisposed: () => () => undefined,
      subscribe: (_address: MachineAddress) =>
        new Promise((resolve) => {
          resolveBootstrap = resolve;
        }),
      unsubscribe: () => Promise.resolve(),
      dispatch,
    };
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      connection,
    );
    const onSettled = vi.fn();

    manager.ensure(7).send({
      type: "submit",
      request: { chatId: 7, prompt: "fast", onSettled },
    });
    resolveBootstrap({
      protocolVersion: 1,
      machineId: "chat_stream",
      encodedKey: { chatId: 7 },
      actorInstanceId: "actor",
      revision: 1,
      encodedState: {
        ...unavailableChatStreamSnapshot(7),
        revision: 1,
        lastCompletion: {
          intentId: "chat-turn:1",
          invocationRef: {
            kind: "chat-stream",
            entityKey: 7,
            operationId: "chat-stream:2",
          },
          outcome: "completed",
          targetAppId: null,
        },
      },
    });

    await vi.waitFor(() =>
      expect(onSettled).toHaveBeenCalledWith({
        success: true,
        pausedByStepLimit: undefined,
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();

    manager.dispose();
  });

  it("does not rebase a stale queue mutation during resync", async () => {
    const subscribe = vi.fn(async () => ({
      protocolVersion: 1,
      machineId: "chat_stream",
      encodedKey: { chatId: 7 },
      actorInstanceId: "actor",
      revision: 5,
      encodedState: {
        ...unavailableChatStreamSnapshot(7),
        revision: 5,
        queueRevision: 9,
      },
    }));
    const dispatch = vi.fn(async (envelope: MachineDispatchEnvelope) => ({
      kind: "rejected" as const,
      messageId: envelope.messageId,
      reason: "revision-conflict" as const,
    }));
    const connection: ChatStreamRemoteConnection = {
      getStatus: () => "connected",
      onStatusChange: () => () => undefined,
      onSnapshot: () => () => undefined,
      onDisposed: () => () => undefined,
      subscribe,
      unsubscribe: () => Promise.resolve(),
      dispatch,
    };
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      connection,
    );
    manager.start();
    const release = manager.ensure(7).subscribe(() => undefined);
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());

    await expect(
      manager.dispatchQueueEvent(
        7,
        { type: "REMOVE_QUEUE_ENTRY", itemId: "queued" },
        4,
      ),
    ).rejects.toThrow("Chat queue request rejected: revision-conflict");

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        encodedEvent: expect.objectContaining({
          type: "REMOVE_QUEUE_ENTRY",
          expectedQueueRevision: 4,
        }),
      }),
    );

    release();
    manager.dispose();
  });
});

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
  it("starts a subscription-only renderer and follows later snapshots", async () => {
    let deliverSnapshot: (payload: unknown) => void = () => undefined;
    const start = vi.fn(() => () => undefined);
    const connection: ChatStreamRemoteConnection = {
      getStatus: () => "connected",
      onStatusChange: () => () => undefined,
      onSnapshot: (listener) => {
        deliverSnapshot = listener;
        return () => undefined;
      },
      onDisposed: () => () => undefined,
      subscribe: async (address) => ({
        ...address,
        actorInstanceId: "actor",
        revision: 1,
        encodedState: {
          ...unavailableChatStreamSnapshot(7),
          revision: 1,
          phase: "streaming",
          invocationRef: {
            kind: "chat-stream",
            entityKey: 7,
            operationId: "active-stream",
          },
        },
      }),
      unsubscribe: () => Promise.resolve(),
      dispatch: vi.fn(),
      start,
    };
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      connection,
    );
    const listener = vi.fn();

    const release = manager.ensure(7).subscribe(listener);
    await vi.waitFor(() =>
      expect(manager.getSnapshot(7).phase).toBe("streaming"),
    );
    deliverSnapshot({
      protocolVersion: 1,
      machineId: "chat_stream",
      encodedKey: { chatId: 7 },
      actorInstanceId: "actor",
      revision: 2,
      encodedState: {
        ...unavailableChatStreamSnapshot(7),
        revision: 2,
        lastCompletion: {
          intentId: "observed-turn",
          invocationRef: {
            kind: "chat-stream",
            entityKey: 7,
            operationId: "active-stream",
          },
          outcome: "completed",
          targetAppId: null,
        },
      },
    });

    await vi.waitFor(() =>
      expect(manager.getSnapshot(7).lastCompletion?.intentId).toBe(
        "observed-turn",
      ),
    );
    expect(start).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalled();

    release();
    manager.dispose();
  });

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

  it("settles an accepted replay whose completion was already observed", async () => {
    let deliverSnapshot: (payload: unknown) => void = () => undefined;
    const completedSnapshot = {
      ...unavailableChatStreamSnapshot(7),
      revision: 1,
      lastCompletion: {
        intentId: "request-1",
        invocationRef: {
          kind: "chat-stream" as const,
          entityKey: 7,
          operationId: "original-operation",
        },
        outcome: "completed" as const,
        targetAppId: null,
      },
    };
    const connection: ChatStreamRemoteConnection = {
      getStatus: () => "connected",
      onStatusChange: () => () => undefined,
      onSnapshot: (listener) => {
        deliverSnapshot = listener;
        return () => undefined;
      },
      onDisposed: () => () => undefined,
      subscribe: async (address) => ({
        ...address,
        actorInstanceId: "actor",
        revision: 1,
        encodedState: completedSnapshot,
      }),
      unsubscribe: () => Promise.resolve(),
      dispatch: vi.fn(async (envelope: MachineDispatchEnvelope) => {
        queueMicrotask(() =>
          deliverSnapshot({
            protocolVersion: 1,
            machineId: "chat_stream",
            encodedKey: { chatId: 7 },
            actorInstanceId: "actor",
            revision: 2,
            encodedState: {
              ...completedSnapshot,
              revision: 2,
              lastAcceptance: {
                intentId: "request-1",
                acceptance: "message-accepted",
                acceptedMessageId: 42,
              },
            },
          }),
        );
        return {
          kind: "applied",
          actorInstanceId: "actor",
          revision: 2,
          transactionSequence: 1,
          messageId: envelope.messageId,
        } as const;
      }),
    };
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      connection,
    );
    const ref = manager.ensure(7);
    const release = ref.subscribe(() => undefined);
    await vi.waitFor(() =>
      expect(manager.getSnapshot(7).lastCompletion?.intentId).toBe("request-1"),
    );
    const onAccepted = vi.fn();
    const onSettled = vi.fn();

    ref.send({
      type: "submit",
      request: {
        chatId: 7,
        prompt: "follow up",
        owner: { kind: "user-input-follow-up", requestId: "request-1" },
        onAccepted,
        onSettled,
      },
    });

    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledOnce());
    expect(onSettled).toHaveBeenCalledWith({
      success: true,
      pausedByStepLimit: undefined,
    });

    release();
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

  it("does not unsubscribe across an immediate renderer remount", async () => {
    const subscribe = vi.fn(async () => ({
      protocolVersion: 1,
      machineId: "chat_stream",
      encodedKey: { chatId: 7 },
      actorInstanceId: "actor",
      revision: 1,
      encodedState: unavailableChatStreamSnapshot(7),
    }));
    const unsubscribe = vi.fn(async () => undefined);
    const connection: ChatStreamRemoteConnection = {
      getStatus: () => "connected",
      onStatusChange: () => () => undefined,
      onSnapshot: () => () => undefined,
      onDisposed: () => () => undefined,
      subscribe,
      unsubscribe,
      dispatch: vi.fn(),
    };
    const manager = new ChatStreamRemoteManager(
      createStore(),
      createSequentialIdSource(),
      connection,
    );
    manager.start();
    const ref = manager.ensure(7);

    const firstRelease = ref.subscribe(() => undefined);
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled());
    firstRelease();
    const secondRelease = ref.subscribe(() => undefined);
    await Promise.resolve();
    expect(unsubscribe).not.toHaveBeenCalled();

    secondRelease();
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    manager.dispose();
  });
});

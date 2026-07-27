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
});

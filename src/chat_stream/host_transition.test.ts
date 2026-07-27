import { describe, expect, it } from "vitest";
import {
  initialChatStreamHostState,
  transitionChatStreamHost,
} from "./host_transition";
import type { SerializableChatTurnIntent } from "./transport";

function intent(intentId: string): SerializableChatTurnIntent {
  return {
    schemaVersion: 1,
    intentId,
    payloadHash: `hash-${intentId}`,
    chatId: 7,
    invocationRef: {
      kind: "chat-stream",
      entityKey: 7,
      operationId: `operation-${intentId}`,
    },
    prompt: "Build it",
  };
}

describe("transitionChatStreamHost", () => {
  it("keeps the active turn authoritative while a second submission queues", () => {
    const first = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: intent("first"),
    });
    expect(first.kind).toBe("applied");
    if (first.kind !== "applied") return;

    const second = transitionChatStreamHost(first.state, {
      type: "SUBMIT",
      intent: intent("second"),
    });

    expect(second.kind).toBe("applied");
    if (second.kind !== "applied") return;
    expect(second.state.active?.intent.intentId).toBe("first");
    expect(second.commands).toEqual([
      { type: "persist-queued", intent: intent("second") },
    ]);
  });

  it("does not leave a replayed accepted turn stuck in admitting", () => {
    const admitted = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: intent("accepted"),
    });
    expect(admitted.kind).toBe("applied");
    if (admitted.kind !== "applied") return;

    const replayed = transitionChatStreamHost(admitted.state, {
      type: "ADMISSION_REPLAYED",
      intentId: "accepted",
      acceptance: "message-accepted",
      acceptedMessageId: 42,
    });

    expect(replayed.kind).toBe("applied");
    if (replayed.kind !== "applied") return;
    expect(replayed.state.phase).toBe("idle");
    expect(replayed.state.active).toBeNull();
    expect(replayed.state.lastAcceptance).toEqual({
      intentId: "accepted",
      acceptance: "replayed",
      acceptedMessageId: 42,
    });
  });

  it("rejects a queue edit made against a stale revision", () => {
    const state = initialChatStreamHostState({
      queueRevision: 4,
      queuePaused: false,
      queue: [],
    });
    const result = transitionChatStreamHost(state, {
      type: "PAUSE_QUEUE",
      expectedQueueRevision: 3,
      mutationId: "pause-1",
    });

    expect(result).toEqual({
      kind: "ignored",
      state,
      reason: "queue-revision-conflict",
    });
  });
});

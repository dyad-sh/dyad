import { describe, expect, it } from "vitest";
import {
  initialChatStreamHostState,
  transitionChatStreamHost,
} from "../host_transition";
import type { ChatStreamHostState } from "../host_state";
import type { SerializableChatTurnIntent } from "../transport";

const invocationRef = {
  kind: "chat-stream" as const,
  entityKey: 7,
  operationId: "operation-1",
};

const intent: SerializableChatTurnIntent = {
  schemaVersion: 1,
  intentId: "intent-1",
  payloadHash: "hash-1",
  chatId: 7,
  invocationRef,
  prompt: "hello",
};

function appliedState(
  state: ChatStreamHostState,
  event: Parameters<typeof transitionChatStreamHost>[1],
): ChatStreamHostState {
  const result = transitionChatStreamHost(state, event);
  expect(result.kind).toBe("applied");
  return result.state;
}

function streamingState(): ChatStreamHostState {
  let state = appliedState(initialChatStreamHostState(), {
    type: "SUBMIT",
    intent,
  });
  state = appliedState(state, {
    type: "ADMISSION_ACCEPTED",
    intentId: intent.intentId,
    invocationRef,
    acceptedMessageId: 12,
    targetAppId: 3,
  });
  return state;
}

describe("main-hosted chat stream terminal projection", () => {
  it("retains end metadata and the authoritative app through finalization", () => {
    let state = appliedState(streamingState(), {
      type: "STREAM_ENDED",
      intentId: intent.intentId,
      invocationRef,
      targetAppId: 3,
      response: {
        chatId: 7,
        invocationRef,
        updatedFiles: true,
        extraFiles: ["src/new.ts"],
        extraFilesError: "one file was skipped",
        warningMessages: ["careful"],
      },
    });

    expect(state.lastCompletion).toMatchObject({
      targetAppId: 3,
      updatedFiles: true,
      extraFiles: ["src/new.ts"],
      extraFilesError: "one file was skipped",
      warningMessages: ["careful"],
    });

    state = appliedState(state, {
      type: "QUEUE_MUTATED",
      queueRevision: 1,
      paused: false,
      entries: [],
    });
    expect(state).toMatchObject({ phase: "idle", error: null, active: null });
  });

  it("keeps a stream failure visible after persistence finalizes", () => {
    let state = appliedState(streamingState(), {
      type: "STREAM_ERRORED",
      intentId: intent.intentId,
      invocationRef,
      error: "provider unavailable",
      warningMessages: ["quota was refunded"],
      targetAppId: 3,
    });

    state = appliedState(state, {
      type: "QUEUE_MUTATED",
      queueRevision: 1,
      paused: false,
      entries: [],
    });

    expect(state).toMatchObject({
      phase: "errored",
      error: "provider unavailable",
      active: null,
      lastCompletion: {
        outcome: "errored",
        targetAppId: 3,
        error: "provider unavailable",
        warningMessages: ["quota was refunded"],
      },
    });
  });

  it("continues queued turns after a failed stream finalizes", () => {
    const errored = appliedState(streamingState(), {
      type: "STREAM_ERRORED",
      intentId: intent.intentId,
      invocationRef,
      error: "provider unavailable",
      targetAppId: 3,
    });

    const finalized = transitionChatStreamHost(errored, {
      type: "QUEUE_MUTATED",
      queueRevision: 2,
      paused: false,
      entries: [
        {
          itemId: "queued",
          intentId: "queued",
          prompt: "try later",
          persistence: "main-session",
          editable: true,
          removable: true,
        },
      ],
    });

    expect(finalized.kind).toBe("applied");
    if (finalized.kind !== "applied") return;
    expect(finalized.state.phase).toBe("errored");
    expect(finalized.commands).toEqual([{ type: "dispatch-next" }]);
  });
});

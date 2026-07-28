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

  it("parks a submission admitted while cancellation is settling", () => {
    const activeIntent = intent("active");
    const cancelling = {
      ...initialChatStreamHostState(),
      phase: "cancelling" as const,
      active: {
        intent: activeIntent,
        invocationRef: activeIntent.invocationRef!,
        targetAppId: 3,
      },
    };

    const submitted = transitionChatStreamHost(cancelling, {
      type: "SUBMIT",
      intent: intent("late"),
    });

    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    expect(submitted.state).toBe(cancelling);
    expect(submitted.commands).toEqual([
      { type: "persist-queued", intent: intent("late") },
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
      acceptance: "message-accepted",
      acceptedMessageId: 42,
    });
  });

  it("keeps a running turn active when the same accepted intent is replayed", () => {
    const activeIntent = intent("accepted");
    const state = {
      ...initialChatStreamHostState(),
      phase: "streaming" as const,
      active: {
        intent: activeIntent,
        invocationRef: activeIntent.invocationRef!,
        targetAppId: 3,
      },
    };

    const replayed = transitionChatStreamHost(state, {
      type: "ADMISSION_REPLAYED",
      intentId: "accepted",
      acceptance: "message-accepted",
      acceptedMessageId: 42,
    });

    expect(replayed.kind).toBe("applied");
    if (replayed.kind !== "applied") return;
    expect(replayed.state).toMatchObject({
      phase: "streaming",
      active: { intent: { intentId: "accepted" } },
      lastAcceptance: {
        intentId: "accepted",
        acceptance: "message-accepted",
        acceptedMessageId: 42,
      },
    });
    expect(replayed.commands).toEqual([]);
  });

  it("preserves queued acceptance when replaying a durable queued turn", () => {
    const admitted = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: intent("queued"),
    });
    expect(admitted.kind).toBe("applied");
    if (admitted.kind !== "applied") return;

    const replayed = transitionChatStreamHost(admitted.state, {
      type: "ADMISSION_REPLAYED",
      intentId: "queued",
      acceptance: "queued",
    });

    expect(replayed.kind).toBe("applied");
    if (replayed.kind !== "applied") return;
    expect(replayed.state.lastAcceptance).toEqual({
      intentId: "queued",
      acceptance: "queued",
    });
  });

  it("finalizes a rejected queued intent before draining the queue", () => {
    const queuedEntry = {
      itemId: "queued",
      intentId: "queued",
      prompt: "Queued",
      persistence: "main-session" as const,
      editable: true,
      removable: true,
    };
    const submitted = transitionChatStreamHost(
      initialChatStreamHostState({
        queueRevision: 1,
        queuePaused: false,
        queue: [queuedEntry],
      }),
      { type: "SUBMIT", intent: intent("queued") },
    );
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;

    const rejected = transitionChatStreamHost(submitted.state, {
      type: "ADMISSION_REJECTED",
      intentId: "queued",
      error: "Follow-up is no longer due",
    });
    expect(rejected.kind).toBe("applied");
    if (rejected.kind !== "applied") return;
    expect(rejected.state).toMatchObject({
      phase: "finalizing",
      active: { intent: { intentId: "queued" } },
      lastCompletion: {
        intentId: "queued",
        outcome: "errored",
      },
    });
    expect(rejected.commands).toEqual([
      {
        type: "finalize",
        intentId: "queued",
        error: "Follow-up is no longer due",
      },
    ]);

    const finalized = transitionChatStreamHost(rejected.state, {
      type: "QUEUE_MUTATED",
      queueRevision: 2,
      paused: false,
      entries: [],
    });
    expect(finalized.kind).toBe("applied");
    if (finalized.kind !== "applied") return;
    expect(finalized.state).toMatchObject({
      phase: "errored",
      active: null,
      queue: [],
    });
    expect(finalized.commands).toEqual([]);
  });

  it("continues draining the queue after an active intent errors", () => {
    const remainingEntry = {
      itemId: "remaining",
      intentId: "remaining",
      prompt: "Try this next",
      persistence: "main-session" as const,
      editable: true,
      removable: true,
    };
    const activeIntent = intent("rejected");
    const state = {
      ...initialChatStreamHostState({
        queueRevision: 1,
        queuePaused: false,
        queue: [remainingEntry],
      }),
      phase: "finalizing" as const,
      active: {
        intent: activeIntent,
        invocationRef: activeIntent.invocationRef!,
        targetAppId: 3,
      },
      error: "Admission failed",
      lastCompletion: {
        intentId: activeIntent.intentId,
        invocationRef: activeIntent.invocationRef!,
        outcome: "errored" as const,
        error: "Admission failed",
        targetAppId: 3,
      },
    };

    const finalized = transitionChatStreamHost(state, {
      type: "QUEUE_MUTATED",
      queueRevision: 2,
      paused: false,
      entries: [remainingEntry],
    });

    expect(finalized.kind).toBe("applied");
    if (finalized.kind !== "applied") return;
    expect(finalized.state).toMatchObject({
      phase: "errored",
      active: null,
      queue: [{ intentId: "remaining" }],
    });
    expect(finalized.commands).toEqual([{ type: "dispatch-next" }]);
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

  it("does not clear or dispatch across an uncorrelated queue refresh", () => {
    const queuedEntry = {
      itemId: "queued",
      intentId: "queued",
      prompt: "Queued",
      persistence: "main-session" as const,
      editable: true,
      removable: true,
    };
    const submitted = transitionChatStreamHost(
      initialChatStreamHostState({
        queueRevision: 2,
        queuePaused: false,
        queue: [queuedEntry],
      }),
      { type: "SUBMIT", intent: intent("active") },
    );
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    const accepted = transitionChatStreamHost(submitted.state, {
      type: "ADMISSION_ACCEPTED",
      intentId: "active",
      invocationRef: intent("active").invocationRef!,
      targetAppId: 3,
    });
    expect(accepted.kind).toBe("applied");
    if (accepted.kind !== "applied") return;
    const mutation = transitionChatStreamHost(accepted.state, {
      type: "REMOVE_QUEUE_ENTRY",
      itemId: "queued",
      expectedQueueRevision: 2,
      mutationId: "remove-queued",
    });
    expect(mutation.kind).toBe("applied");
    if (mutation.kind !== "applied") return;
    const ending = transitionChatStreamHost(mutation.state, {
      type: "STREAM_ENDED",
      intentId: "active",
      invocationRef: intent("active").invocationRef!,
      response: {
        chatId: 7,
        invocationRef: intent("active").invocationRef!,
        updatedFiles: false,
      },
      targetAppId: 3,
    });
    expect(ending.kind).toBe("applied");
    if (ending.kind !== "applied") return;

    const finalizationRefresh = transitionChatStreamHost(ending.state, {
      type: "QUEUE_MUTATED",
      queueRevision: 2,
      paused: false,
      entries: [queuedEntry],
    });
    expect(finalizationRefresh.kind).toBe("applied");
    if (finalizationRefresh.kind !== "applied") return;
    expect(finalizationRefresh.state.pendingQueueMutationId).toBe(
      "remove-queued",
    );
    expect(finalizationRefresh.commands).toEqual([]);

    const mutationCompleted = transitionChatStreamHost(
      finalizationRefresh.state,
      {
        type: "QUEUE_MUTATED",
        mutationId: "remove-queued",
        queueRevision: 3,
        paused: false,
        entries: [],
      },
    );
    expect(mutationCompleted.kind).toBe("applied");
    if (mutationCompleted.kind !== "applied") return;
    expect(mutationCompleted.state.pendingQueueMutationId).toBeNull();
  });

  it("recovers to a terminal state when a lifecycle command fails", () => {
    const submitted = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: intent("active"),
    });
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;

    const failed = transitionChatStreamHost(submitted.state, {
      type: "LIFECYCLE_COMMAND_FAILED",
      command: "cancel-active",
      intentId: "active",
      invocationRef: intent("active").invocationRef!,
      error: "cancel failed",
      queueRevision: 4,
      paused: true,
      entries: [],
    });

    expect(failed.kind).toBe("applied");
    if (failed.kind !== "applied") return;
    expect(failed.state).toMatchObject({
      phase: "errored",
      active: null,
      error: "cancel failed",
      queueRevision: 4,
      queuePaused: true,
      lastCompletion: {
        intentId: "active",
        outcome: "errored",
      },
    });
  });

  it("reconciles the authoritative queue after a mutation side effect fails", () => {
    const state = {
      ...initialChatStreamHostState({
        queueRevision: 2,
        queuePaused: false,
        queue: [],
      }),
      pendingQueueMutationId: "clear-1",
    };
    const rejected = transitionChatStreamHost(state, {
      type: "QUEUE_MUTATION_REJECTED",
      mutationId: "clear-1",
      error: "owner settlement failed",
      queueRevision: 3,
      paused: true,
      entries: [
        {
          itemId: "owner",
          intentId: "owner",
          prompt: "Keep me",
          persistence: "main-session",
          editable: false,
          removable: true,
        },
      ],
    });

    expect(rejected.kind).toBe("applied");
    if (rejected.kind !== "applied") return;
    expect(rejected.state).toMatchObject({
      queueRevision: 3,
      queuePaused: true,
      queue: [{ intentId: "owner" }],
      pendingQueueMutationId: null,
      lastQueueMutation: {
        mutationId: "clear-1",
        outcome: "rejected",
      },
    });
  });
});

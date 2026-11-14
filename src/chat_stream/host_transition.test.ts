import { describe, expect, it } from "vitest";
import {
  initialChatStreamHostState,
  transitionChatStreamHost,
} from "./host_transition";
import { validateTransitionResult } from "@/state_machines/transition_validation";
import type { SerializableChatTurnIntent } from "./transport";
import {
  canCancelActiveChatStreamPhase,
  canCancelChatStreamPhase,
} from "./transition";

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
  it("keeps the same state for a queue mutation that changes nothing", () => {
    const started = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: intent("first"),
    });
    if (started.kind !== "applied") throw new Error("expected applied");
    const event = {
      type: "QUEUE_MUTATED" as const,
      queueRevision: started.state.queueRevision,
      paused: false,
      entries: [],
    };

    const result = transitionChatStreamHost(started.state, event);

    expect(result.state).toBe(started.state);
    expect(result.kind === "applied" && result.commands).toEqual([]);
    expect(() =>
      validateTransitionResult(started.state, event, result),
    ).not.toThrow();
  });

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
      {
        type: "persist-queued",
        intent: intent("second"),
        resumeQueue: false,
      },
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
      {
        type: "persist-queued",
        intent: intent("late"),
        resumeQueue: false,
      },
    ]);
  });

  it("appends and resumes an explicit submission into an idle parked queue", () => {
    const parked = {
      ...initialChatStreamHostState({
        queueRevision: 4,
        queuePaused: true,
        queue: [
          {
            itemId: "first",
            intentId: "first",
            prompt: "First queued prompt",
            persistence: "durable" as const,
            editable: true,
            removable: true,
          },
        ],
      }),
      queuePauseReason: "stop" as const,
    };

    const submitted = transitionChatStreamHost(parked, {
      type: "SUBMIT",
      intent: intent("late"),
      observedStopPolicyVersion: 0,
    });

    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    expect(submitted.state).toBe(parked);
    expect(submitted.commands).toEqual([
      {
        type: "persist-queued",
        intent: intent("late"),
        resumeQueue: true,
        observedStopPolicyVersion: 0,
      },
    ]);

    const queued = transitionChatStreamHost(submitted.state, {
      type: "ADMISSION_QUEUED",
      intentId: "late",
      entry: {
        itemId: "late",
        intentId: "late",
        prompt: "Build it",
        persistence: "durable",
        editable: true,
        removable: true,
      },
      queueRevision: 5,
      queuePaused: false,
      resumeQueue: true,
      observedStopPolicyVersion: 0,
    });
    expect(queued.kind).toBe("applied");
    if (queued.kind !== "applied") return;
    expect(queued.state.queue.map((entry) => entry.intentId)).toEqual([
      "first",
      "late",
    ]);
    expect(queued.commands).toEqual([{ type: "dispatch-next" }]);
  });

  it("keeps a pre-Stop tail parked after the actor becomes idle", () => {
    const parked = {
      ...initialChatStreamHostState(),
      queuePaused: true,
      queuePauseReason: "stop" as const,
      stopPolicyVersion: 1,
    };

    const submitted = transitionChatStreamHost(parked, {
      type: "SUBMIT",
      intent: intent("late"),
      observedStopPolicyVersion: 0,
    });

    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    expect(submitted.state).toBe(parked);
    expect(submitted.commands).toEqual([
      {
        type: "persist-queued",
        intent: intent("late"),
        resumeQueue: false,
        observedStopPolicyVersion: 0,
      },
    ]);
  });

  it("resumes only after a submission observes the latest Stop policy", () => {
    const parked = {
      ...initialChatStreamHostState(),
      queuePaused: true,
      queuePauseReason: "stop" as const,
      stopPolicyVersion: 2,
      lastStopId: "stop-2",
    };

    const submitted = transitionChatStreamHost(parked, {
      type: "SUBMIT",
      intent: intent("after-stop"),
      observedStopPolicyVersion: 2,
    });

    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    expect(submitted.commands).toEqual([
      {
        type: "persist-queued",
        intent: intent("after-stop"),
        resumeQueue: true,
        observedStopPolicyVersion: 2,
      },
    ]);
  });

  it("does not let an older queued admission clear a newer Stop", () => {
    const parked = {
      ...initialChatStreamHostState(),
      queuePaused: true,
      queuePauseReason: "stop" as const,
      stopPolicyVersion: 1,
      lastStopId: "stop-1",
    };
    const submitted = transitionChatStreamHost(parked, {
      type: "SUBMIT",
      intent: intent("after-stop-1"),
      observedStopPolicyVersion: 1,
    });
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;

    const stoppedAgain = transitionChatStreamHost(submitted.state, {
      type: "CANCEL",
      invocationRef: intent("stale").invocationRef!,
      pauseQueue: true,
      stopId: "stop-2",
      observedStopPolicyVersion: 1,
    });
    expect(stoppedAgain.kind).toBe("applied");
    if (stoppedAgain.kind !== "applied") return;

    const queued = transitionChatStreamHost(stoppedAgain.state, {
      type: "ADMISSION_QUEUED",
      intentId: "after-stop-1",
      entry: {
        itemId: "after-stop-1",
        intentId: "after-stop-1",
        prompt: "Build it",
        persistence: "durable",
        editable: true,
        removable: true,
      },
      queueRevision: 1,
      queuePaused: false,
      resumeQueue: true,
      observedStopPolicyVersion: 1,
    });

    expect(queued.kind).toBe("applied");
    if (queued.kind !== "applied") return;
    expect(queued.state).toMatchObject({
      stopPolicyVersion: 2,
      queuePaused: true,
      queuePauseReason: "stop",
    });
    expect(queued.commands).toEqual([]);

    const replayed = transitionChatStreamHost(stoppedAgain.state, {
      type: "QUEUE_MUTATED",
      queueRevision: 1,
      paused: false,
      entries: [
        {
          itemId: "after-stop-1",
          intentId: "after-stop-1",
          prompt: "Build it",
          persistence: "durable",
          editable: true,
          removable: true,
        },
      ],
      resumeQueue: true,
      observedStopPolicyVersion: 1,
    });
    expect(replayed.kind).toBe("applied");
    if (replayed.kind !== "applied") return;
    expect(replayed.state).toMatchObject({
      stopPolicyVersion: 2,
      queuePaused: true,
      queuePauseReason: "stop",
    });
    expect(replayed.commands).toEqual([]);
  });

  it("does not resume a Stop-parked queue without an observed policy version", () => {
    const parked = {
      ...initialChatStreamHostState(),
      queuePaused: true,
      queuePauseReason: "stop" as const,
      stopPolicyVersion: 2,
    };

    const submitted = transitionChatStreamHost(parked, {
      type: "SUBMIT",
      intent: intent("missing-version"),
    });

    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    expect(submitted.commands).toEqual([
      {
        type: "persist-queued",
        intent: intent("missing-version"),
        resumeQueue: false,
      },
    ]);
  });

  it("cancels and parks the queue through one authoritative intent", () => {
    const activeIntent = intent("active");
    const submitted = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: activeIntent,
    });
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;

    const cancelling = transitionChatStreamHost(submitted.state, {
      type: "CANCEL",
      invocationRef: activeIntent.invocationRef!,
      pauseQueue: true,
      stopId: "stop-1",
    });
    expect(cancelling.kind).toBe("applied");
    if (cancelling.kind !== "applied") return;
    expect(cancelling.state.active?.pauseQueueOnCancel).toBe(true);
    expect(cancelling.state.stopPolicyVersion).toBe(1);
    expect(cancelling.state.queuePaused).toBe(true);
    expect(cancelling.commands).toEqual([
      { type: "park-queue" },
      {
        type: "cancel-active",
        invocationRef: activeIntent.invocationRef!,
      },
    ]);

    const ended = transitionChatStreamHost(cancelling.state, {
      type: "STREAM_ENDED",
      intentId: activeIntent.intentId,
      invocationRef: activeIntent.invocationRef!,
      response: {
        chatId: 7,
        invocationRef: activeIntent.invocationRef!,
        updatedFiles: false,
        wasCancelled: true,
      },
      targetAppId: 3,
    });
    expect(ended.kind).toBe("applied");
    if (ended.kind !== "applied") return;
    expect(ended.state.lastCompletion?.pausePromptQueue).toBeUndefined();
    expect(ended.commands).toEqual([
      {
        type: "finalize",
        intentId: activeIntent.intentId,
        response: {
          chatId: 7,
          invocationRef: activeIntent.invocationRef!,
          updatedFiles: false,
          wasCancelled: true,
        },
      },
    ]);

    const finalized = transitionChatStreamHost(ended.state, {
      type: "QUEUE_MUTATED",
      queueRevision: 1,
      paused: true,
      entries: [],
    });
    expect(finalized.kind).toBe("applied");
    if (finalized.kind !== "applied") return;
    expect(finalized.state.queuePauseReason).toBe("stop");
  });

  it.each(["manual", "step-limit"] as const)(
    "starts a new turn immediately while a %s pause keeps older prompts parked",
    (queuePauseReason) => {
      const paused = {
        ...initialChatStreamHostState({
          queueRevision: 2,
          queuePaused: true,
          queue: [
            {
              itemId: "older",
              intentId: "older",
              prompt: "Older prompt",
              persistence: "durable" as const,
              editable: true,
              removable: true,
            },
          ],
        }),
        queuePauseReason,
      };

      const submitted = transitionChatStreamHost(paused, {
        type: "SUBMIT",
        intent: intent("new"),
      });

      expect(submitted.kind).toBe("applied");
      if (submitted.kind !== "applied") return;
      expect(submitted.state).toMatchObject({
        phase: "admitting",
        queuePaused: true,
        queuePauseReason,
        queue: [expect.objectContaining({ intentId: "older" })],
      });
      expect(submitted.commands).toEqual([
        { type: "admit-and-start", intent: intent("new") },
      ]);
    },
  );

  it("drains a queued admission that lands after the queue was unpaused", () => {
    const idle = initialChatStreamHostState();
    const queued = transitionChatStreamHost(idle, {
      type: "ADMISSION_QUEUED",
      intentId: "late",
      entry: {
        itemId: "late",
        intentId: "late",
        prompt: "Late prompt",
        persistence: "durable",
        editable: true,
        removable: true,
      },
      queueRevision: 1,
      queuePaused: false,
      resumeQueue: false,
    });

    expect(queued.kind).toBe("applied");
    if (queued.kind !== "applied") return;
    expect(queued.commands).toEqual([{ type: "dispatch-next" }]);
  });

  it("keeps an admission parked when Stop takes ownership before persistence settles", () => {
    const stopped = {
      ...initialChatStreamHostState(),
      queuePaused: false,
      queuePauseReason: "stop" as const,
      stopPolicyVersion: 1,
    };
    const queued = transitionChatStreamHost(stopped, {
      type: "ADMISSION_QUEUED",
      intentId: "late",
      entry: {
        itemId: "late",
        intentId: "late",
        prompt: "Late prompt",
        persistence: "durable",
        editable: true,
        removable: true,
      },
      queueRevision: 1,
      queuePaused: false,
      resumeQueue: false,
    });

    expect(queued.kind).toBe("applied");
    if (queued.kind !== "applied") return;
    expect(queued.state).toMatchObject({
      queuePaused: true,
      queuePauseReason: "stop",
      queue: [{ intentId: "late" }],
    });
    expect(queued.commands).toEqual([]);
  });

  it("does not advance or reapply an already-observed Stop cutoff", () => {
    const stopped = {
      ...initialChatStreamHostState(),
      stopPolicyVersion: 1,
      lastStopId: "stop-1",
      queuePaused: true,
    };

    const duplicate = transitionChatStreamHost(stopped, {
      type: "CANCEL",
      invocationRef: intent("old").invocationRef!,
      pauseQueue: true,
      stopId: "stop-1",
    });

    expect(duplicate).toEqual({
      kind: "ignored",
      state: stopped,
      reason: "not-cancellable",
    });
  });

  it("ignores an older Stop that arrives after a newer cutoff", () => {
    const resumed = {
      ...initialChatStreamHostState(),
      stopPolicyVersion: 2,
      lastStopId: "newer-stop",
    };

    const stale = transitionChatStreamHost(resumed, {
      type: "CANCEL",
      invocationRef: intent("old").invocationRef!,
      pauseQueue: true,
      stopId: "older-stop",
      observedStopPolicyVersion: 1,
    });

    expect(stale).toEqual({
      kind: "ignored",
      state: resumed,
      reason: "not-cancellable",
    });
  });

  it("keeps Stop authoritative over a late manual-pause acknowledgement", () => {
    const activeIntent = intent("active");
    const active = {
      ...initialChatStreamHostState(),
      phase: "streaming" as const,
      active: {
        intent: activeIntent,
        invocationRef: activeIntent.invocationRef!,
        targetAppId: 3,
        pauseQueueOnCancel: false,
      },
      pendingQueueMutationId: "manual-pause",
      pendingQueuePauseMutationId: "manual-pause",
    };
    const stopped = transitionChatStreamHost(active, {
      type: "CANCEL",
      invocationRef: activeIntent.invocationRef!,
      pauseQueue: true,
      stopId: "stop-1",
      observedStopPolicyVersion: 0,
    });
    expect(stopped.kind).toBe("applied");
    if (stopped.kind !== "applied") return;
    expect(stopped.state.pendingQueuePauseMutationId).toBeNull();

    const latePause = transitionChatStreamHost(stopped.state, {
      type: "QUEUE_MUTATED",
      mutationId: "manual-pause",
      queueRevision: 1,
      paused: true,
      entries: [],
    });
    expect(latePause.kind).toBe("applied");
    if (latePause.kind !== "applied") return;
    expect(latePause.state.queuePauseReason).toBe("stop");
  });

  it("keeps Stop authoritative when an in-flight manual pause is rejected", () => {
    const activeIntent = intent("active");
    const stopped = {
      ...initialChatStreamHostState(),
      phase: "cancelling" as const,
      active: {
        intent: activeIntent,
        invocationRef: activeIntent.invocationRef!,
        targetAppId: 3,
        pauseQueueOnCancel: true,
      },
      queuePauseReason: "stop" as const,
      pendingQueueMutationId: "manual-pause",
    };

    const rejected = transitionChatStreamHost(stopped, {
      type: "QUEUE_MUTATION_REJECTED",
      mutationId: "manual-pause",
      error: "revision conflict",
      queueRevision: 1,
      paused: false,
      entries: [],
    });

    expect(rejected.kind).toBe("applied");
    if (rejected.kind !== "applied") return;
    expect(rejected.state).toMatchObject({
      queuePaused: true,
      queuePauseReason: "stop",
      pendingQueueMutationId: null,
    });
  });

  it("parks a late Stop while finalization is already in progress", () => {
    const activeIntent = intent("active");
    const submitted = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: activeIntent,
    });
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    const finalizing = transitionChatStreamHost(submitted.state, {
      type: "STREAM_ENDED",
      intentId: activeIntent.intentId,
      invocationRef: activeIntent.invocationRef!,
      response: {
        chatId: 7,
        invocationRef: activeIntent.invocationRef!,
        updatedFiles: false,
      },
      targetAppId: 3,
    });
    expect(finalizing.kind).toBe("applied");
    if (finalizing.kind !== "applied") return;
    expect(finalizing.state.lastCompletion?.pausePromptQueue).toBeUndefined();

    const stopped = transitionChatStreamHost(finalizing.state, {
      type: "CANCEL",
      invocationRef: activeIntent.invocationRef!,
      pauseQueue: true,
    });
    expect(stopped.kind).toBe("applied");
    if (stopped.kind !== "applied") return;
    expect(stopped.state).toMatchObject({
      phase: "finalizing",
      queuePaused: true,
      active: { pauseQueueOnCancel: true },
    });
    expect(stopped.commands).toEqual([{ type: "park-queue" }]);

    const finalized = transitionChatStreamHost(stopped.state, {
      type: "QUEUE_MUTATED",
      queueRevision: 1,
      paused: false,
      entries: [
        {
          itemId: "queued",
          intentId: "queued",
          prompt: "Keep this parked",
          persistence: "main-session",
          editable: true,
          removable: true,
        },
      ],
    });
    expect(finalized.kind).toBe("applied");
    if (finalized.kind !== "applied") return;
    expect(finalized.commands).toEqual([]);
  });

  it("lets an explicit queue resume supersede the Stop latch", () => {
    const activeIntent = intent("active");
    const submitted = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: activeIntent,
    });
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    const stopped = transitionChatStreamHost(submitted.state, {
      type: "CANCEL",
      invocationRef: activeIntent.invocationRef!,
      pauseQueue: true,
    });
    expect(stopped.kind).toBe("applied");
    if (stopped.kind !== "applied") return;
    const resumed = transitionChatStreamHost(stopped.state, {
      type: "RESUME_QUEUE",
      expectedQueueRevision: stopped.state.queueRevision,
      mutationId: "resume-after-stop",
      observedStopPolicyVersion: stopped.state.stopPolicyVersion,
    });
    expect(resumed.kind).toBe("applied");
    if (resumed.kind !== "applied") return;
    expect(resumed.state.pendingQueueResumeMutationId).toBe(
      "resume-after-stop",
    );
    expect(resumed.state.active).toMatchObject({
      pauseQueueOnCancel: true,
    });

    const confirmed = transitionChatStreamHost(resumed.state, {
      type: "QUEUE_MUTATED",
      mutationId: "resume-after-stop",
      queueRevision: resumed.state.queueRevision + 1,
      paused: false,
      entries: [],
      observedStopPolicyVersion: stopped.state.stopPolicyVersion,
    });
    expect(confirmed.kind).toBe("applied");
    if (confirmed.kind !== "applied") return;
    expect(confirmed.state.pendingQueueResumeMutationId).toBeNull();
    expect(confirmed.state.active).toMatchObject({
      pauseQueueOnCancel: false,
      queueResumedAfterCancel: true,
    });

    const ended = transitionChatStreamHost(confirmed.state, {
      type: "STREAM_ENDED",
      intentId: activeIntent.intentId,
      invocationRef: activeIntent.invocationRef!,
      response: {
        chatId: 7,
        invocationRef: activeIntent.invocationRef!,
        updatedFiles: false,
        wasCancelled: true,
      },
      targetAppId: 3,
    });
    expect(ended.kind).toBe("applied");
    if (ended.kind !== "applied") return;
    expect(ended.state.lastCompletion?.pausePromptQueue).toBeUndefined();
    expect(ended.commands).toEqual([
      {
        type: "finalize",
        intentId: activeIntent.intentId,
        response: {
          chatId: 7,
          invocationRef: activeIntent.invocationRef!,
          updatedFiles: false,
          wasCancelled: true,
        },
      },
    ]);
  });

  it("keeps a newer Stop authoritative over a late resume acknowledgement", () => {
    const activeIntent = intent("active");
    const state = {
      ...initialChatStreamHostState(),
      phase: "cancelling" as const,
      stopPolicyVersion: 1,
      queuePaused: true,
      queuePauseReason: "stop" as const,
      active: {
        intent: activeIntent,
        invocationRef: activeIntent.invocationRef!,
        targetAppId: 3,
        pauseQueueOnCancel: true,
      },
    };
    const requested = transitionChatStreamHost(state, {
      type: "RESUME_QUEUE",
      expectedQueueRevision: 0,
      mutationId: "stale-resume",
      observedStopPolicyVersion: 1,
    });
    expect(requested.kind).toBe("applied");
    if (requested.kind !== "applied") return;

    const stoppedAgain = transitionChatStreamHost(requested.state, {
      type: "CANCEL",
      invocationRef: activeIntent.invocationRef!,
      pauseQueue: true,
      stopId: "newer-stop",
      observedStopPolicyVersion: 1,
    });
    expect(stoppedAgain.kind).toBe("applied");
    if (stoppedAgain.kind !== "applied") return;

    const confirmed = transitionChatStreamHost(stoppedAgain.state, {
      type: "QUEUE_MUTATED",
      mutationId: "stale-resume",
      queueRevision: 1,
      paused: false,
      entries: [],
      observedStopPolicyVersion: 1,
    });
    expect(confirmed.kind).toBe("applied");
    if (confirmed.kind !== "applied") return;
    expect(confirmed.state).toMatchObject({
      stopPolicyVersion: 2,
      queuePaused: true,
      queuePauseReason: "stop",
      active: { pauseQueueOnCancel: true },
      lastQueueMutation: {
        mutationId: "stale-resume",
        outcome: "rejected",
      },
    });
    expect(confirmed.commands).toEqual([]);
  });

  it("rejects a resume that already predates the current Stop", () => {
    const state = {
      ...initialChatStreamHostState({
        queueRevision: 4,
        queuePaused: true,
        queuePauseReason: "stop",
        queue: [],
      }),
      stopPolicyVersion: 2,
    };

    const resumed = transitionChatStreamHost(state, {
      type: "RESUME_QUEUE",
      expectedQueueRevision: 4,
      mutationId: "stale-resume",
      observedStopPolicyVersion: 1,
    });

    expect(resumed.kind).toBe("applied");
    if (resumed.kind !== "applied") return;
    expect(resumed.state.lastQueueMutation).toMatchObject({
      mutationId: "stale-resume",
      outcome: "rejected",
    });
    expect(resumed.commands).toEqual([]);
  });

  it("lets an idle explicit resume release the current Stop latch", () => {
    const queuedEntry = {
      itemId: "queued",
      intentId: "queued",
      prompt: "Run me",
      persistence: "durable" as const,
      editable: true,
      removable: true,
    };
    const state = {
      ...initialChatStreamHostState({
        queueRevision: 4,
        queuePaused: true,
        queuePauseReason: "stop",
        queue: [queuedEntry],
      }),
      stopPolicyVersion: 2,
    };
    const requested = transitionChatStreamHost(state, {
      type: "RESUME_QUEUE",
      expectedQueueRevision: 4,
      mutationId: "idle-resume",
      observedStopPolicyVersion: 2,
    });
    expect(requested.kind).toBe("applied");
    if (requested.kind !== "applied") return;
    expect(requested.commands).toEqual([
      {
        type: "mutate-queue",
        mutation: { type: "resume", preserveStopPause: false },
        expectedQueueRevision: 4,
        mutationId: "idle-resume",
        observedStopPolicyVersion: 2,
      },
    ]);

    const confirmed = transitionChatStreamHost(requested.state, {
      type: "QUEUE_MUTATED",
      mutationId: "idle-resume",
      queueRevision: 5,
      paused: false,
      entries: [queuedEntry],
      observedStopPolicyVersion: 2,
    });
    expect(confirmed.kind).toBe("applied");
    if (confirmed.kind !== "applied") return;
    expect(confirmed.state).toMatchObject({
      queuePaused: false,
      queuePauseReason: null,
      pendingQueueResumeMutationId: null,
    });
    expect(confirmed.commands).toEqual([{ type: "dispatch-next" }]);
  });

  it("retains the Stop latch when an explicit queue resume is rejected", () => {
    const activeIntent = intent("active");
    const state = {
      ...initialChatStreamHostState({
        queueRevision: 4,
        queuePaused: true,
        queue: [],
      }),
      phase: "cancelling" as const,
      active: {
        intent: activeIntent,
        invocationRef: activeIntent.invocationRef!,
        targetAppId: 3,
        pauseQueueOnCancel: true,
        queueResumedAfterCancel: false,
      },
    };
    const requested = transitionChatStreamHost(state, {
      type: "RESUME_QUEUE",
      expectedQueueRevision: 4,
      mutationId: "failed-resume",
    });
    expect(requested.kind).toBe("applied");
    if (requested.kind !== "applied") return;

    const rejected = transitionChatStreamHost(requested.state, {
      type: "QUEUE_MUTATION_REJECTED",
      mutationId: "failed-resume",
      error: "revision conflict",
      queueRevision: 4,
      paused: true,
      entries: [],
    });
    expect(rejected.kind).toBe("applied");
    if (rejected.kind !== "applied") return;
    expect(rejected.state.pendingQueueResumeMutationId).toBeNull();
    expect(rejected.state.active).toMatchObject({
      pauseQueueOnCancel: true,
      queueResumedAfterCancel: false,
    });
  });

  it("preserves a genuine response pause after the Stop latch is resumed", () => {
    const activeIntent = intent("step-limited");
    const state = {
      ...initialChatStreamHostState(),
      phase: "cancelling" as const,
      active: {
        intent: activeIntent,
        invocationRef: activeIntent.invocationRef!,
        targetAppId: 3,
        pauseQueueOnCancel: false,
        queueResumedAfterCancel: true,
      },
    };

    const ended = transitionChatStreamHost(state, {
      type: "STREAM_ENDED",
      intentId: activeIntent.intentId,
      invocationRef: activeIntent.invocationRef!,
      response: {
        chatId: 7,
        invocationRef: activeIntent.invocationRef!,
        pausePromptQueue: true,
        updatedFiles: false,
      },
      targetAppId: 3,
    });

    expect(ended.kind).toBe("applied");
    if (ended.kind !== "applied") return;
    expect(ended.state.lastCompletion?.pausePromptQueue).toBe(true);
    expect(ended.commands).toEqual([
      {
        type: "finalize",
        intentId: activeIntent.intentId,
        response: {
          chatId: 7,
          invocationRef: activeIntent.invocationRef!,
          pausePromptQueue: true,
          updatedFiles: false,
        },
      },
    ]);

    const finalized = transitionChatStreamHost(ended.state, {
      type: "QUEUE_MUTATED",
      queueRevision: 1,
      paused: true,
      entries: [],
    });
    expect(finalized.kind).toBe("applied");
    if (finalized.kind !== "applied") return;
    expect(finalized.state.queuePauseReason).toBe("step-limit");
  });

  it("parks a stale Stop without cancelling a newer invocation", () => {
    const newerIntent = intent("newer");
    const state = {
      ...initialChatStreamHostState(),
      phase: "streaming" as const,
      active: {
        intent: newerIntent,
        invocationRef: newerIntent.invocationRef!,
        targetAppId: 3,
        pauseQueueOnCancel: false,
      },
    };

    const stopped = transitionChatStreamHost(state, {
      type: "CANCEL",
      invocationRef: intent("stale").invocationRef!,
      pauseQueue: true,
    });

    expect(stopped.kind).toBe("applied");
    if (stopped.kind !== "applied") return;
    expect(stopped.state.active).toBe(state.active);
    expect(stopped.state.queuePaused).toBe(true);
    expect(stopped.commands).toEqual([{ type: "park-queue" }]);
  });

  it("latches Stop before asynchronous queue parking completes", () => {
    const queued = {
      itemId: "already-queued",
      intentId: "already-queued",
      prompt: "Run first",
      persistence: "durable" as const,
      editable: true,
      removable: true,
    };
    const state = initialChatStreamHostState({
      queueRevision: 3,
      queuePaused: false,
      queue: [queued],
    });

    const stopped = transitionChatStreamHost(state, {
      type: "CANCEL",
      invocationRef: intent("already-finished").invocationRef!,
      pauseQueue: true,
      observedStopPolicyVersion: 0,
    });
    expect(stopped.kind).toBe("applied");
    if (stopped.kind !== "applied") return;
    expect(stopped.state).toMatchObject({
      queuePaused: true,
      queuePauseReason: "stop",
      stopPolicyVersion: 1,
    });

    const submitted = transitionChatStreamHost(stopped.state, {
      type: "SUBMIT",
      intent: intent("submitted-before-park"),
      observedStopPolicyVersion: 1,
    });
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    expect(submitted.state.active).toBeNull();
    expect(submitted.commands).toEqual([
      {
        type: "persist-queued",
        intent: intent("submitted-before-park"),
        observedStopPolicyVersion: 1,
        resumeQueue: true,
      },
    ]);
  });

  it("ignores stale queue parking results", () => {
    const state = initialChatStreamHostState({
      queueRevision: 5,
      queuePaused: false,
      queue: [],
    });

    expect(
      transitionChatStreamHost(state, {
        type: "QUEUE_PARKED",
        queueRevision: 4,
        paused: true,
        entries: [],
      }),
    ).toEqual({ kind: "ignored", state, reason: "invalid-host-event" });
    expect(
      transitionChatStreamHost(state, {
        type: "QUEUE_PARK_FAILED",
        error: "stale failure",
        queueRevision: 4,
        paused: true,
        entries: [],
      }),
    ).toEqual({ kind: "ignored", state, reason: "invalid-host-event" });
  });

  it("keeps Stop fail-closed when queue parking fails", () => {
    const stopped = {
      ...initialChatStreamHostState({
        queueRevision: 2,
        queuePaused: false,
        queue: [],
      }),
      stopPolicyVersion: 1,
      queuePauseReason: "stop" as const,
    };
    const failed = transitionChatStreamHost(stopped, {
      type: "QUEUE_PARK_FAILED",
      error: "database unavailable",
      queueRevision: 2,
      paused: false,
      entries: [],
    });
    expect(failed.kind).toBe("applied");
    if (failed.kind !== "applied") return;
    expect(failed.state).toMatchObject({
      queuePaused: true,
      queuePauseReason: "stop",
    });

    const delayed = transitionChatStreamHost(failed.state, {
      type: "ADMISSION_QUEUED",
      intentId: "delayed",
      entry: {
        itemId: "delayed",
        intentId: "delayed",
        prompt: "Stay parked",
        persistence: "durable",
        editable: true,
        removable: true,
      },
      queueRevision: 3,
      queuePaused: false,
      resumeQueue: false,
      observedStopPolicyVersion: 0,
    });
    expect(delayed.kind).toBe("applied");
    if (delayed.kind !== "applied") return;
    expect(delayed.state.queuePaused).toBe(true);
    expect(delayed.commands).toEqual([]);
  });

  it("advertises Stop through lifecycle settlement", () => {
    expect(
      ["admitting", "streaming", "cancelling", "finalizing"].every((phase) =>
        canCancelChatStreamPhase(
          phase as Parameters<typeof canCancelChatStreamPhase>[0],
        ),
      ),
    ).toBe(true);
    expect(canCancelChatStreamPhase("idle")).toBe(false);
    expect(canCancelChatStreamPhase("errored")).toBe(false);
  });

  it("advertises active cancellation only before settlement", () => {
    expect(canCancelActiveChatStreamPhase("admitting")).toBe(true);
    expect(canCancelActiveChatStreamPhase("streaming")).toBe(true);
    expect(canCancelActiveChatStreamPhase("cancelling")).toBe(false);
    expect(canCancelActiveChatStreamPhase("finalizing")).toBe(false);
  });

  it("retries queue parking when cancellation fails", () => {
    const activeIntent = intent("active");
    const submitted = transitionChatStreamHost(initialChatStreamHostState(), {
      type: "SUBMIT",
      intent: activeIntent,
    });
    expect(submitted.kind).toBe("applied");
    if (submitted.kind !== "applied") return;
    const cancelling = transitionChatStreamHost(submitted.state, {
      type: "CANCEL",
      invocationRef: activeIntent.invocationRef!,
      pauseQueue: true,
    });
    expect(cancelling.kind).toBe("applied");
    if (cancelling.kind !== "applied") return;

    const failed = transitionChatStreamHost(cancelling.state, {
      type: "LIFECYCLE_COMMAND_FAILED",
      command: "cancel-active",
      intentId: activeIntent.intentId,
      invocationRef: activeIntent.invocationRef!,
      error: "cancel failed",
      queueRevision: 4,
      paused: false,
      entries: [],
    });
    expect(failed.kind).toBe("applied");
    if (failed.kind !== "applied") return;
    expect(failed.state).toMatchObject({
      phase: "errored",
      queuePaused: false,
      active: null,
    });
    expect(failed.commands).toEqual([{ type: "park-queue" }]);
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

  it("returns to the authoritative paused queue when replaying a durable queued turn", () => {
    const queuedEntry = {
      itemId: "queued",
      intentId: "queued",
      prompt: "Build it",
      persistence: "durable" as const,
      editable: true,
      removable: true,
    };
    const admitted = transitionChatStreamHost(
      initialChatStreamHostState({
        queueRevision: 2,
        queuePaused: true,
        queue: [queuedEntry],
      }),
      {
        type: "SUBMIT",
        intent: intent("queued"),
      },
    );
    expect(admitted.kind).toBe("applied");
    if (admitted.kind !== "applied") return;
    expect(admitted.commands).toEqual([
      {
        type: "persist-queued",
        intent: intent("queued"),
        resumeQueue: false,
      },
    ]);

    const replayed = transitionChatStreamHost(admitted.state, {
      type: "ADMISSION_REPLAYED",
      intentId: "queued",
      acceptance: "queued",
    });

    expect(replayed.kind).toBe("applied");
    if (replayed.kind !== "applied") return;
    expect(replayed.state.phase).toBe("idle");
    expect(replayed.state.active).toBeNull();
    expect(replayed.state.queue).toEqual([queuedEntry]);
    expect(replayed.state.lastAcceptance).toEqual({
      intentId: "queued",
      acceptance: "queued",
    });
    expect(replayed.commands).toEqual([]);
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

  it("records an explicit queue pause separately from Stop and step limit", () => {
    const state = initialChatStreamHostState({
      queueRevision: 4,
      queuePaused: false,
      queue: [],
    });
    const requested = transitionChatStreamHost(state, {
      type: "PAUSE_QUEUE",
      expectedQueueRevision: 4,
      mutationId: "pause-1",
    });
    expect(requested.kind).toBe("applied");
    if (requested.kind !== "applied") return;

    const confirmed = transitionChatStreamHost(requested.state, {
      type: "QUEUE_MUTATED",
      mutationId: "pause-1",
      queueRevision: 5,
      paused: true,
      entries: [],
    });
    expect(confirmed.kind).toBe("applied");
    if (confirmed.kind !== "applied") return;
    expect(confirmed.state.queuePauseReason).toBe("manual");
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

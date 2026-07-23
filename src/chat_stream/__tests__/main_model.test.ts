import { describe, expect, it } from "vitest";

import { exploreReachableStates } from "@/state_machines/testing";
import {
  assertMainModelQuiescence,
  assertMainModelTransitionInvariants,
  initialMainModelState,
  mainModelStateKey,
  transitionMainModel,
  type MainModelEvent,
  type MainModelState,
} from "../main_model";

function apply(state: MainModelState, event: MainModelEvent): MainModelState {
  const result = transitionMainModel(state, event);
  assertMainModelTransitionInvariants(state, event, result);
  return result.state;
}

function advanceToStreaming(
  state = initialMainModelState,
  invocationId = 1,
  chatId = 7,
  streamId = invocationId,
): MainModelState {
  let next = apply(state, {
    type: "request-received",
    invocationId,
    streamId,
    chatId,
    appId: 9,
  });
  next = apply(next, { type: "handler-advanced", invocationId });
  next = apply(next, { type: "handler-advanced", invocationId });
  next = apply(next, { type: "handler-advanced", invocationId });
  return next;
}

const explorationEvents: MainModelEvent[] = [
  {
    type: "request-received",
    invocationId: 1,
    streamId: 1,
    chatId: 7,
    appId: 9,
  },
  { type: "handler-advanced", invocationId: 1 },
  { type: "handler-advanced", invocationId: 1, throws: true },
  { type: "handler-advanced", invocationId: 1, applyError: true },
  { type: "barrier-installed", scope: { type: "chat", chatId: 7 } },
  { type: "barrier-released", scope: { type: "chat", chatId: 7 } },
  { type: "barrier-installed", scope: { type: "app", appId: 9 } },
  { type: "barrier-released", scope: { type: "app", appId: 9 } },
  { type: "cancel-chat", chatId: 7 },
  { type: "cancel-app", appId: 9 },
  { type: "llm-settled", invocationId: 1, outcome: "completed" },
  {
    type: "llm-settled",
    invocationId: 1,
    outcome: "completed",
    hasResponse: false,
  },
  { type: "llm-settled", invocationId: 1, outcome: "errored" },
  { type: "llm-settled", invocationId: 1, outcome: "aborted" },
  { type: "compaction-started", invocationId: 1 },
  {
    type: "compaction-finished",
    invocationId: 1,
    outcome: "completed",
  },
  { type: "handler-unwound", invocationId: 1 },
  { type: "quit" },
];

function reachableStates(): MainModelState[] {
  return exploreReachableStates({
    initialState: initialMainModelState,
    events: (state) =>
      explorationEvents.filter((event) => {
        if (state.quit) return event.type === "quit";
        if (event.type === "request-received")
          return state.streams[event.invocationId] === undefined;
        if (event.type === "barrier-installed") {
          return event.scope.type === "chat"
            ? (state.chatBarrierCounts[event.scope.chatId] ?? 0) === 0
            : (state.appBarrierCounts[event.scope.appId] ?? 0) === 0;
        }
        return true;
      }),
    transition: transitionMainModel,
    stateKey: mainModelStateKey,
    maxStates: 20_000,
  });
}

describe("main chat stream model", () => {
  it("is total over every reachable state and event", () => {
    const states = reachableStates();
    expect(states.length).toBeGreaterThan(10);
    for (const state of states) {
      for (const event of explorationEvents) {
        const result = transitionMainModel(state, event);
        expect(result).toBeDefined();
        assertMainModelTransitionInvariants(state, event, result);
      }
    }
  });

  it("I1 keeps admission atomic with both covering barriers", () => {
    let state = apply(initialMainModelState, {
      type: "request-received",
      invocationId: 1,
      streamId: 1,
      chatId: 7,
      appId: 9,
    });
    state = apply(state, { type: "handler-advanced", invocationId: 1 });
    state = apply(state, {
      type: "barrier-installed",
      scope: { type: "chat", chatId: 7 },
    });
    state = apply(state, { type: "handler-advanced", invocationId: 1 });
    expect(state.streams[1].phase).toBe("waiting-chat-barrier");
    state = apply(state, {
      type: "barrier-released",
      scope: { type: "chat", chatId: 7 },
    });
    state = apply(state, {
      type: "barrier-installed",
      scope: { type: "app", appId: 9 },
    });
    state = apply(state, { type: "handler-advanced", invocationId: 1 });
    expect(state.streams[1].phase).toBe("waiting-app-barrier");
  });

  it("I2 reserves wasCancelled for cancel and suppresses aborted finalizer end", () => {
    let state = advanceToStreaming();
    const cancelled = transitionMainModel(state, {
      type: "cancel-chat",
      chatId: 7,
    });
    assertMainModelTransitionInvariants(
      state,
      { type: "cancel-chat", chatId: 7 },
      cancelled,
    );
    expect(
      cancelled.commands.filter(
        (command) => command.type === "chat:response:end",
      ),
    ).toEqual([
      expect.objectContaining({
        origin: "cancel",
        payload: expect.objectContaining({ wasCancelled: true }),
      }),
    ]);
    state = cancelled.state;
    state = apply(state, {
      type: "llm-settled",
      invocationId: 1,
      outcome: "aborted",
    });
    const finalized = transitionMainModel(state, {
      type: "handler-unwound",
      invocationId: 1,
    });
    expect(finalized.commands.map((command) => command.type)).toEqual([
      "completion-resolved",
    ]);
  });

  it("I3 permits early cancellation terminals but not admission through a barrier", () => {
    let state = apply(initialMainModelState, {
      type: "request-received",
      invocationId: 1,
      streamId: 1,
      chatId: 7,
      appId: 9,
    });
    state = apply(state, { type: "handler-advanced", invocationId: 1 });
    state = apply(state, {
      type: "barrier-installed",
      scope: { type: "app", appId: 9 },
    });
    const cancelled = transitionMainModel(state, {
      type: "cancel-chat",
      chatId: 7,
    });
    expect(cancelled.commands.map((command) => command.type)).toEqual([
      "chat:response:end",
      "chat:stream:end",
    ]);
    state = apply(cancelled.state, {
      type: "handler-advanced",
      invocationId: 1,
    });
    expect(state.streams[1].phase).toBe("unwinding-aborted");

    let pending = apply(initialMainModelState, {
      type: "request-received",
      invocationId: 2,
      streamId: 2,
      chatId: 7,
      appId: 9,
    });
    pending = apply(pending, { type: "handler-advanced", invocationId: 2 });
    const admitted = transitionMainModel(pending, {
      type: "handler-advanced",
      invocationId: 2,
    });
    expect(() =>
      assertMainModelTransitionInvariants(
        pending,
        { type: "handler-advanced", invocationId: 2 },
        {
          ...admitted,
          state: {
            ...admitted.state,
            streams: {
              ...admitted.state.streams,
              2: { ...admitted.state.streams[2], cancelNotified: true },
            },
          },
        },
      ),
    ).toThrow(/early-notify admission safety/);
  });

  it("I4 wakes waiters and clears released barrier bookkeeping", () => {
    let state = apply(initialMainModelState, {
      type: "request-received",
      invocationId: 1,
      streamId: 1,
      chatId: 7,
      appId: 9,
    });
    state = apply(state, { type: "handler-advanced", invocationId: 1 });
    state = apply(state, {
      type: "barrier-installed",
      scope: { type: "chat", chatId: 7 },
    });
    state = apply(state, { type: "handler-advanced", invocationId: 1 });
    state = apply(state, {
      type: "barrier-released",
      scope: { type: "chat", chatId: 7 },
    });
    expect(() => assertMainModelQuiescence(state)).not.toThrow();
  });

  it("accepts quit from every reachable phase", () => {
    for (const state of reachableStates().filter(
      (candidate) => !candidate.quit,
    )) {
      const result = transitionMainModel(state, { type: "quit" });
      expect(result.state.quit).toBe(true);
      expect(result.commands).toEqual([]);
      for (const stream of Object.values(result.state.streams)) {
        expect(stream.phase).toBe("quit-cleared");
        expect(stream.aborted).toBe(true);
        expect(stream.completionResolved).toBe(
          state.streams[stream.invocationId].completionResolved,
        );
      }
      expect(() => assertMainModelQuiescence(result.state)).not.toThrow();
    }
  });

  it("models cancel during compaction as aborting without persistence before completion resolves", () => {
    let state = advanceToStreaming();
    state = apply(state, { type: "compaction-started", invocationId: 1 });
    const cancelled = transitionMainModel(state, {
      type: "cancel-chat",
      chatId: 7,
    });
    expect(cancelled.state.streams[1]).toMatchObject({
      phase: "streaming",
      awaitPoint: "compaction",
      aborted: true,
    });
    state = apply(cancelled.state, {
      type: "compaction-finished",
      invocationId: 1,
      outcome: "aborted",
    });
    expect(state.pendingCompactionChats).toEqual([7]);
    expect(state.compactionSummaryChats).toEqual([]);
    expect(state.compactionCompleteBroadcastChats).toEqual([]);
    state = apply(state, {
      type: "llm-settled",
      invocationId: 1,
      outcome: "aborted",
    });
    expect(state.streams[1].completionResolved).toBe(false);
    state = apply(state, { type: "handler-unwound", invocationId: 1 });
    expect(state.streams[1].completionResolved).toBe(true);
  });

  it("models the apply-error path as error plus non-cancelled end", () => {
    let state = advanceToStreaming();
    state = apply(state, {
      type: "llm-settled",
      invocationId: 1,
      outcome: "completed",
    });
    state = apply(state, { type: "handler-advanced", invocationId: 1 });
    const result = transitionMainModel(state, {
      type: "handler-advanced",
      invocationId: 1,
      applyError: true,
    });
    expect(result.commands.map((command) => command.type)).toEqual([
      "chat:response:error",
      "chat:response:end",
    ]);
    expect(result.commands[1]).toMatchObject({
      payload: { updatedFiles: false },
      origin: "handler",
    });
  });

  it("suppresses handler terminals when cancellation is observed before the final guard", () => {
    let state = advanceToStreaming();
    state = apply(state, { type: "cancel-chat", chatId: 7 });
    const result = transitionMainModel(state, {
      type: "llm-settled",
      invocationId: 1,
      outcome: "completed",
    });
    expect(result.state.streams[1].phase).toBe("unwinding-aborted");
    expect(result.commands).toEqual([]);

    const errored = transitionMainModel(state, {
      type: "llm-settled",
      invocationId: 1,
      outcome: "errored",
    });
    expect(errored.state.streams[1].phase).toBe("unwinding-aborted");
    expect(errored.commands).toEqual([]);
  });

  it("models empty responses without a handler response-end", () => {
    const state = advanceToStreaming();
    const result = transitionMainModel(state, {
      type: "llm-settled",
      invocationId: 1,
      outcome: "completed",
      hasResponse: false,
    });
    expect(result.state.streams[1].phase).toBe("unwinding-completed");
    expect(result.commands).toEqual([]);
  });

  it.each(["post-abort-db", "post-abort-apply"] as const)(
    "keeps outer-catch errors legal after the %s await, including after cancel",
    (awaitPoint) => {
      let state = advanceToStreaming();
      state = apply(state, {
        type: "llm-settled",
        invocationId: 1,
        outcome: "completed",
      });
      if (awaitPoint === "post-abort-apply") {
        state = apply(state, { type: "handler-advanced", invocationId: 1 });
      }
      state = apply(state, { type: "cancel-chat", chatId: 7 });
      const result = transitionMainModel(state, {
        type: "handler-advanced",
        invocationId: 1,
        throws: true,
      });
      expect(result.state.streams[1].phase).toBe("unwinding-errored");
      expect(result.commands).toEqual([
        expect.objectContaining({
          type: "chat:response:error",
          origin: "handler",
        }),
      ]);
    },
  );

  it("emits cancellation responses per generation and transport ends per chat on every call", () => {
    let state = advanceToStreaming();
    state = advanceToStreaming(state, 2);
    const first = transitionMainModel(state, {
      type: "cancel-chat",
      chatId: 7,
    });
    expect(first.commands.map((command) => command.type)).toEqual([
      "chat:response:end",
      "chat:response:end",
      "chat:stream:end",
    ]);
    const second = transitionMainModel(first.state, {
      type: "cancel-chat",
      chatId: 7,
    });
    expect(second.commands.map((command) => command.type)).toEqual([
      "chat:response:end",
      "chat:response:end",
      "chat:stream:end",
    ]);
  });

  it("keeps same-generation streams from different chats as distinct invocations", () => {
    let state = advanceToStreaming(initialMainModelState, 1, 7, 1);
    state = advanceToStreaming(state, 2, 8, 1);
    expect(Object.keys(state.streams)).toEqual(["1", "2"]);
    expect(state.streams[1]).toMatchObject({ chatId: 7, streamId: 1 });
    expect(state.streams[2]).toMatchObject({ chatId: 8, streamId: 1 });

    const cancelled = transitionMainModel(state, {
      type: "cancel-app",
      appId: 9,
    });
    expect(
      cancelled.commands
        .filter((command) => command.type === "chat:response:end")
        .map((command) => [command.payload.chatId, command.payload.streamId]),
    ).toEqual([
      [7, 1],
      [8, 1],
    ]);
    expect(
      cancelled.commands
        .filter((command) => command.type === "chat:stream:end")
        .map((command) => command.payload.chatId),
    ).toEqual([7, 8]);
  });

  it("documents two concurrent streams observing pendingCompaction=true", () => {
    let state = advanceToStreaming();
    state = advanceToStreaming(state, 2);
    state = apply(state, { type: "compaction-started", invocationId: 1 });
    state = apply(state, { type: "compaction-started", invocationId: 2 });
    expect(state.streams[1].awaitPoint).toBe("compaction");
    expect(state.streams[2].awaitPoint).toBe("compaction");
    expect(state.pendingCompactionChats).toEqual([7]);
  });
});

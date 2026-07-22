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
  streamId = 1,
): MainModelState {
  let next = apply(state, {
    type: "request-received",
    streamId,
    chatId: 7,
    appId: 9,
  });
  next = apply(next, { type: "handler-advanced", streamId });
  next = apply(next, { type: "handler-advanced", streamId });
  next = apply(next, { type: "handler-advanced", streamId });
  return next;
}

describe("main chat stream model", () => {
  it("is total over every reachable state and event", () => {
    const events: MainModelEvent[] = [
      { type: "request-received", streamId: 1, chatId: 7, appId: 9 },
      { type: "handler-advanced", streamId: 1 },
      { type: "barrier-installed", scope: { type: "chat", chatId: 7 } },
      { type: "barrier-released", scope: { type: "chat", chatId: 7 } },
      { type: "barrier-installed", scope: { type: "app", appId: 9 } },
      { type: "barrier-released", scope: { type: "app", appId: 9 } },
      { type: "cancel-chat", chatId: 7 },
      { type: "cancel-app", appId: 9 },
      { type: "llm-settled", streamId: 1, outcome: "completed" },
      { type: "llm-settled", streamId: 1, outcome: "errored" },
      { type: "llm-settled", streamId: 1, outcome: "aborted" },
      { type: "compaction-started", streamId: 1 },
      { type: "compaction-finished", streamId: 1 },
      { type: "handler-unwound", streamId: 1 },
      { type: "quit" },
    ];
    const states = exploreReachableStates({
      initialState: initialMainModelState,
      events: (state) =>
        events.filter((event) => {
          if (state.quit) return event.type === "quit";
          if (event.type === "request-received")
            return state.streams[event.streamId] === undefined;
          if (event.type === "barrier-installed") {
            return event.scope.type === "chat"
              ? (state.chatBarrierCounts[event.scope.chatId] ?? 0) === 0
              : (state.appBarrierCounts[event.scope.appId] ?? 0) === 0;
          }
          return true;
        }),
      transition: transitionMainModel,
      stateKey: mainModelStateKey,
      maxStates: 10_000,
    });
    expect(states.length).toBeGreaterThan(10);
    for (const state of states) {
      for (const event of events) {
        const result = transitionMainModel(state, event);
        expect(result).toBeDefined();
        assertMainModelTransitionInvariants(state, event, result);
      }
    }
  });

  it("I1 keeps admission atomic with both covering barriers", () => {
    let state = apply(initialMainModelState, {
      type: "request-received",
      streamId: 1,
      chatId: 7,
      appId: 9,
    });
    state = apply(state, { type: "handler-advanced", streamId: 1 });
    state = apply(state, {
      type: "barrier-installed",
      scope: { type: "chat", chatId: 7 },
    });
    state = apply(state, { type: "handler-advanced", streamId: 1 });
    expect(state.streams[1].phase).toBe("waiting-chat-barrier");
    state = apply(state, {
      type: "barrier-released",
      scope: { type: "chat", chatId: 7 },
    });
    state = apply(state, {
      type: "barrier-installed",
      scope: { type: "app", appId: 9 },
    });
    state = apply(state, { type: "handler-advanced", streamId: 1 });
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
      streamId: 1,
      outcome: "aborted",
    });
    const finalized = transitionMainModel(state, {
      type: "handler-unwound",
      streamId: 1,
    });
    expect(finalized.commands.map((command) => command.type)).toEqual([
      "completion-resolved",
    ]);
  });

  it("I3 permits early cancellation terminals but not admission through a barrier", () => {
    let state = apply(initialMainModelState, {
      type: "request-received",
      streamId: 1,
      chatId: 7,
      appId: 9,
    });
    state = apply(state, { type: "handler-advanced", streamId: 1 });
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
    state = apply(cancelled.state, { type: "handler-advanced", streamId: 1 });
    expect(state.streams[1].phase).toBe("unwinding-aborted");
  });

  it("I4 wakes waiters and clears released barrier bookkeeping", () => {
    let state = apply(initialMainModelState, {
      type: "request-received",
      streamId: 1,
      chatId: 7,
      appId: 9,
    });
    state = apply(state, { type: "handler-advanced", streamId: 1 });
    state = apply(state, {
      type: "barrier-installed",
      scope: { type: "chat", chatId: 7 },
    });
    state = apply(state, { type: "handler-advanced", streamId: 1 });
    state = apply(state, {
      type: "barrier-released",
      scope: { type: "chat", chatId: 7 },
    });
    expect(() => assertMainModelQuiescence(state)).not.toThrow();
  });

  it("accepts quit from every reachable phase", () => {
    const states = [
      initialMainModelState,
      apply(initialMainModelState, {
        type: "request-received",
        streamId: 1,
        chatId: 7,
        appId: 9,
      }),
      advanceToStreaming(),
    ];
    for (const state of states) {
      const result = transitionMainModel(state, { type: "quit" });
      expect(result.state.quit).toBe(true);
      expect(
        Object.values(result.state.streams).every(
          (stream) => stream.phase === "finalized",
        ),
      ).toBe(true);
    }
  });

  it("models cancel during compaction as legal and completion-covered", () => {
    let state = advanceToStreaming();
    state = apply(state, { type: "compaction-started", streamId: 1 });
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
      streamId: 1,
    });
    state = apply(state, {
      type: "llm-settled",
      streamId: 1,
      outcome: "aborted",
    });
    expect(state.streams[1].completionResolved).toBe(false);
    state = apply(state, { type: "handler-unwound", streamId: 1 });
    expect(state.streams[1].completionResolved).toBe(true);
  });

  it("models the apply-error path as error plus non-cancelled end", () => {
    let state = advanceToStreaming();
    state = apply(state, {
      type: "llm-settled",
      streamId: 1,
      outcome: "completed",
    });
    state = apply(state, { type: "handler-advanced", streamId: 1 });
    const result = transitionMainModel(state, {
      type: "handler-advanced",
      streamId: 1,
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

  it("keeps the outer-catch error legal after abort", () => {
    let state = advanceToStreaming();
    state = apply(state, { type: "cancel-chat", chatId: 7 });
    const result = transitionMainModel(state, {
      type: "llm-settled",
      streamId: 1,
      outcome: "errored",
    });
    expect(result.state.streams[1].aborted).toBe(true);
    expect(result.commands).toEqual([
      expect.objectContaining({
        type: "chat:response:error",
        origin: "handler",
      }),
    ]);
  });

  it("documents two concurrent streams observing pendingCompaction=true", () => {
    let state = advanceToStreaming();
    state = advanceToStreaming(state, 2);
    state = apply(state, { type: "compaction-started", streamId: 1 });
    state = apply(state, { type: "compaction-started", streamId: 2 });
    expect(state.streams[1].awaitPoint).toBe("compaction");
    expect(state.streams[2].awaitPoint).toBe("compaction");
    expect(state.pendingCompactionChats).toEqual([7]);
  });
});

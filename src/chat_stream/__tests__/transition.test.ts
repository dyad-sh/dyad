import { describe, expect, it } from "vitest";

import type { TransitionResult } from "@/state_machines/types";

import type {
  ChatStreamIgnoreReason,
  StreamCommand,
  StreamEvent,
  StreamRequest,
  StreamState,
} from "../state";
import { initialStreamState, isStreamActive, transition } from "../transition";

const CHAT_ID = 7;

function makeRequest(overrides: Partial<StreamRequest> = {}): StreamRequest {
  return { prompt: "hello", chatId: CHAT_ID, ...overrides };
}

function endResponse(wasCancelled?: boolean) {
  return {
    chatId: CHAT_ID,
    updatedFiles: false,
    ...(wasCancelled === undefined ? {} : { wasCancelled }),
  };
}

const STATE_FACTORIES: Record<StreamState["type"], () => StreamState> = {
  idle: () => ({ type: "idle", lastStreamId: 3 }),
  starting: () => ({ type: "starting", streamId: 4, request: makeRequest() }),
  streaming: () => ({ type: "streaming", streamId: 4, request: makeRequest() }),
  cancelling: () => ({
    type: "cancelling",
    streamId: 4,
    request: makeRequest(),
    registered: false,
  }),
  finalizing: () => ({
    type: "finalizing",
    streamId: 4,
    request: makeRequest(),
    wasCancelled: false,
  }),
  errored: () => ({ type: "errored", lastStreamId: 4, error: "boom" }),
};

/** Representative payloads for every event type. Events that carry a streamId
 * get both a matching (4) and a stale (999) variant. */
function eventVariants(): StreamEvent[] {
  return [
    { type: "submit", request: makeRequest({ prompt: "queued" }) },
    { type: "cancel" },
    { type: "registered" },
    { type: "chunk-received", streamId: 4 },
    { type: "chunk-received", streamId: 999 },
    { type: "stream-ended", streamId: 4, response: endResponse() },
    { type: "stream-ended", streamId: 4, response: endResponse(true) },
    { type: "stream-ended", streamId: 999, response: endResponse() },
    { type: "stream-errored", streamId: 4, error: "kaput" },
    { type: "stream-errored", streamId: 999, error: "kaput" },
    { type: "finalize-complete", streamId: 4, ok: true },
    { type: "finalize-complete", streamId: 4, ok: false },
    { type: "finalize-complete", streamId: 999, ok: true },
    { type: "queue-poked" },
  ];
}

const ACTIVE_OR_FINALIZING: StreamState["type"][] = [
  "starting",
  "streaming",
  "cancelling",
  "finalizing",
];

const ALL_IGNORE_REASONS = new Set<ChatStreamIgnoreReason>([
  "no-active-stream",
  "stale-stream-id",
  "already-registered",
  "already-cancelling",
  "chunk-while-streaming",
  "not-finalizing",
  "stream-active",
  "too-late-to-cancel",
]);

/**
 * Invariant checker applied to every transition in this suite.
 */
function checkInvariants(
  prev: StreamState,
  event: StreamEvent,
  result: TransitionResult<StreamState, StreamCommand, ChatStreamIgnoreReason>,
): void {
  const label = `state=${prev.type} event=${event.type}`;

  // Never two mutating commands in one transition.
  const mutating = result.commands.filter(
    (c) =>
      c.type === "start-stream" ||
      c.type === "request-abort" ||
      c.type === "dispatch-next-queued",
  );
  expect(mutating.length, label).toBeLessThanOrEqual(1);
  // Never more than one side-effecting command overall.
  expect(result.commands.length, label).toBeLessThanOrEqual(1);

  if (result.ignoredReason !== undefined) {
    expect(ALL_IGNORE_REASONS, label).toContain(result.ignoredReason);
    expect(result.state, label).toBe(prev);
    expect(result.commands, label).toEqual([]);
  } else if (result.state === prev && result.commands.length === 0) {
    throw new Error(`${label} returned a reasonless ignore`);
  }

  for (const command of result.commands) {
    switch (command.type) {
      case "start-stream":
        // Streams start only from a terminal state, on submit.
        expect(prev.type === "idle" || prev.type === "errored", label).toBe(
          true,
        );
        expect(event.type, label).toBe("submit");
        // The new generation is strictly monotonic.
        expect(command.streamId, label).toBeGreaterThan(
          prev.type === "idle" || prev.type === "errored"
            ? prev.lastStreamId
            : -1,
        );
        break;
      case "enqueue-message":
        // Submissions while a stream is in flight are queued, never dropped.
        expect(ACTIVE_OR_FINALIZING, label).toContain(prev.type);
        expect(event.type, label).toBe("submit");
        break;
      case "dispatch-next-queued":
        // Queue dispatch only from the finalizing -> idle transition, or an
        // explicit poke while terminal (resume).
        expect(
          (prev.type === "finalizing" && event.type === "finalize-complete") ||
            ((prev.type === "idle" || prev.type === "errored") &&
              event.type === "queue-poked"),
          label,
        ).toBe(true);
        break;
      case "run-end-side-effects":
      case "run-error-side-effects":
        expect(ACTIVE_OR_FINALIZING, label).toContain(prev.type);
        break;
      case "request-abort":
        expect(result.state.type, label).toBe("cancelling");
        break;
      default: {
        const exhaustive: never = command;
        throw new Error(`unexpected command ${String(exhaustive)}`);
      }
    }
  }

  // A stale streamId event never advances state nor emits commands.
  if (
    "streamId" in event &&
    "streamId" in prev &&
    event.streamId !== prev.streamId
  ) {
    expect(result.state, label).toBe(prev);
    expect(result.commands, label).toEqual([]);
  }

  // Terminal-state events never reach terminal states' stream handling.
  if (prev.type === "idle" || prev.type === "errored") {
    if (
      event.type === "stream-ended" ||
      event.type === "stream-errored" ||
      event.type === "chunk-received" ||
      event.type === "finalize-complete"
    ) {
      expect(result.state, label).toBe(prev);
      expect(result.commands, label).toEqual([]);
    }
  }
}

function step(
  state: StreamState,
  event: StreamEvent,
): TransitionResult<StreamState, StreamCommand, ChatStreamIgnoreReason> {
  const result = transition(state, event);
  checkInvariants(state, event, result);
  return result;
}

describe("transition totality", () => {
  it("handles the full state x event matrix without throwing and upholds all invariants", () => {
    const seenIgnoreReasons = new Set<ChatStreamIgnoreReason>();
    for (const makeState of Object.values(STATE_FACTORIES)) {
      for (const event of eventVariants()) {
        const state = makeState();
        const result = step(state, event);
        expect(result.state).toBeDefined();
        expect(Array.isArray(result.commands)).toBe(true);
        if (result.ignoredReason !== undefined) {
          seenIgnoreReasons.add(result.ignoredReason);
        }
      }
    }
    expect(seenIgnoreReasons).toEqual(ALL_IGNORE_REASONS);
  });

  it("returns the identical state reference for ignored pairs (no spurious notifications)", () => {
    const idle = STATE_FACTORIES.idle();
    expect(step(idle, { type: "cancel" }).state).toBe(idle);
    expect(step(idle, { type: "registered" }).state).toBe(idle);

    const streaming = STATE_FACTORIES.streaming();
    expect(step(streaming, { type: "chunk-received", streamId: 4 }).state).toBe(
      streaming,
    );
    expect(step(streaming, { type: "registered" }).state).toBe(streaming);
  });
});

describe("happy path", () => {
  it("walks idle -> starting -> streaming -> finalizing -> idle", () => {
    let result = step(initialStreamState(), {
      type: "submit",
      request: makeRequest(),
    });
    expect(result.state.type).toBe("starting");
    expect(result.commands).toEqual([
      { type: "start-stream", streamId: 1, request: makeRequest() },
    ]);
    expect(isStreamActive(result.state)).toBe(true);

    result = step(result.state, { type: "registered" });
    expect(result.state.type).toBe("streaming");

    result = step(result.state, {
      type: "stream-ended",
      streamId: 1,
      response: endResponse(),
    });
    expect(result.state.type).toBe("finalizing");
    expect(result.commands[0]?.type).toBe("run-end-side-effects");
    expect(isStreamActive(result.state)).toBe(false);

    result = step(result.state, {
      type: "finalize-complete",
      streamId: 1,
      ok: true,
    });
    expect(result.state).toEqual({ type: "idle", lastStreamId: 1 });
    expect(result.commands).toEqual([{ type: "dispatch-next-queued" }]);
  });

  it("promotes starting -> streaming on the first chunk when the registration event was missed", () => {
    const starting = STATE_FACTORIES.starting();
    const result = step(starting, { type: "chunk-received", streamId: 4 });
    expect(result.state.type).toBe("streaming");
  });

  it("errors terminate the stream and a new submit restarts with a fresh generation", () => {
    const streaming = STATE_FACTORIES.streaming();
    let result = step(streaming, {
      type: "stream-errored",
      streamId: 4,
      error: "kaput",
    });
    expect(result.state).toEqual({
      type: "errored",
      lastStreamId: 4,
      error: "kaput",
    });
    expect(result.commands[0]?.type).toBe("run-error-side-effects");

    result = step(result.state, { type: "submit", request: makeRequest() });
    expect(result.state.type).toBe("starting");
    expect(result.commands[0]).toMatchObject({
      type: "start-stream",
      streamId: 5,
    });
  });
});

describe("bug 1: submit while a stream is active queues instead of dropping", () => {
  it("queues a submit during starting (the isStreaming render-lag window)", () => {
    const starting = STATE_FACTORIES.starting();
    const request = makeRequest({ prompt: "second message" });
    const result = step(starting, { type: "submit", request });
    expect(result.state).toBe(starting);
    expect(result.commands).toEqual([{ type: "enqueue-message", request }]);
  });

  it("queues a submit during streaming, cancelling, and finalizing", () => {
    for (const type of ["streaming", "cancelling", "finalizing"] as const) {
      const state = STATE_FACTORIES[type]();
      const request = makeRequest({ prompt: `queued during ${type}` });
      const result = step(state, { type: "submit", request });
      expect(result.state).toBe(state);
      expect(result.commands).toEqual([{ type: "enqueue-message", request }]);
    }
  });
});

describe("bug 2: cancel before main registers the stream", () => {
  it("finalizes on the sole wasCancelled end when the stream was aborted before admission", () => {
    // Submit, then cancel while still starting (main hasn't confirmed
    // registration yet).
    let result = step(initialStreamState(), {
      type: "submit",
      request: makeRequest(),
    });
    result = step(result.state, { type: "cancel" });
    expect(result.state).toMatchObject({
      type: "cancelling",
      registered: false,
    });
    expect(result.commands).toEqual([{ type: "request-abort" }]);

    // Main tracked the AbortController synchronously, so the abort hit the
    // real stream pre-admission. Main sends the SOLE terminal wasCancelled
    // end and will never send chat:stream:start for this stream — the
    // machine must finalize now or deadlock in `cancelling` forever.
    result = step(result.state, {
      type: "stream-ended",
      streamId: 1,
      response: endResponse(true),
    });
    expect(result.state).toMatchObject({
      type: "finalizing",
      wasCancelled: true,
    });
    expect(result.commands[0]?.type).toBe("run-end-side-effects");

    // Cancelled turns do not dispatch the queue.
    result = step(result.state, {
      type: "finalize-complete",
      streamId: 1,
      ok: true,
    });
    expect(result.state).toEqual({ type: "idle", lastStreamId: 1 });
    expect(result.commands).toEqual([]);
  });

  it("re-issues the abort on registration when the cancel raced ahead of the stream request", () => {
    // The abort reached main before `chat:stream` did: main found nothing,
    // sent nothing, and the stream proceeds to registration.
    let result = step(initialStreamState(), {
      type: "submit",
      request: makeRequest(),
    });
    result = step(result.state, { type: "cancel" });
    expect(result.state).toMatchObject({
      type: "cancelling",
      registered: false,
    });

    // Registration arrives: re-issue the abort so the stream actually stops.
    result = step(result.state, { type: "registered" });
    expect(result.state).toMatchObject({
      type: "cancelling",
      registered: true,
    });
    expect(result.commands).toEqual([{ type: "request-abort" }]);

    // The terminal event of the (now aborted) stream drives finalization
    // exactly once.
    result = step(result.state, {
      type: "stream-ended",
      streamId: 1,
      response: endResponse(true),
    });
    expect(result.state).toMatchObject({
      type: "finalizing",
      wasCancelled: true,
    });
    expect(result.commands[0]?.type).toBe("run-end-side-effects");
  });

  it("finalizes with the real outcome when the stream completed before the abort landed", () => {
    let result = step(initialStreamState(), {
      type: "submit",
      request: makeRequest(),
    });
    result = step(result.state, { type: "cancel" });
    // The stream ran to completion (file changes applied) before the abort
    // could land. It must be finalized as a success so refreshes and
    // invalidations run.
    result = step(result.state, {
      type: "stream-ended",
      streamId: 1,
      response: endResponse(false),
    });
    expect(result.state).toMatchObject({
      type: "finalizing",
      wasCancelled: false,
    });
    expect(result.commands[0]?.type).toBe("run-end-side-effects");
  });

  it("treats an end after registration as real even while cancelling", () => {
    const streaming = STATE_FACTORIES.streaming();
    let result = step(streaming, { type: "cancel" });
    expect(result.state).toMatchObject({
      type: "cancelling",
      registered: true,
    });
    result = step(result.state, {
      type: "stream-ended",
      streamId: 4,
      response: endResponse(true),
    });
    expect(result.state).toMatchObject({
      type: "finalizing",
      wasCancelled: true,
    });
  });
});

describe("bug 3: queue dispatch is single-shot by construction", () => {
  it("emits dispatch-next-queued exactly once, on finalizing -> idle", () => {
    const finalizing = STATE_FACTORIES.finalizing();
    const result = step(finalizing, {
      type: "finalize-complete",
      streamId: 4,
      ok: true,
    });
    expect(result.state).toEqual({ type: "idle", lastStreamId: 4 });
    expect(result.commands).toEqual([{ type: "dispatch-next-queued" }]);

    // A replayed/duplicate finalize-complete is ignored: no second dispatch.
    const replay = step(result.state, {
      type: "finalize-complete",
      streamId: 4,
      ok: true,
    });
    expect(replay.state).toBe(result.state);
    expect(replay.commands).toEqual([]);
  });

  it("does not dispatch after a cancelled or failed finalization", () => {
    const cancelled: StreamState = {
      ...STATE_FACTORIES.finalizing(),
      wasCancelled: true,
    } as StreamState;
    expect(
      step(cancelled, { type: "finalize-complete", streamId: 4, ok: true })
        .commands,
    ).toEqual([]);

    const failed = step(STATE_FACTORIES.finalizing(), {
      type: "finalize-complete",
      streamId: 4,
      ok: false,
    });
    expect(failed.state.type).toBe("idle");
    expect(failed.commands).toEqual([]);
  });

  it("dispatches on an explicit poke only while terminal", () => {
    expect(
      step(STATE_FACTORIES.idle(), { type: "queue-poked" }).commands,
    ).toEqual([{ type: "dispatch-next-queued" }]);
    expect(
      step(STATE_FACTORIES.errored(), { type: "queue-poked" }).commands,
    ).toEqual([{ type: "dispatch-next-queued" }]);
    for (const type of ACTIVE_OR_FINALIZING) {
      expect(
        step(STATE_FACTORIES[type](), { type: "queue-poked" }).commands,
      ).toEqual([]);
    }
  });
});

describe("stale generation rejection", () => {
  it("never advances state on events tagged with a stale streamId", () => {
    for (const type of ACTIVE_OR_FINALIZING) {
      const state = STATE_FACTORIES[type]();
      const staleEvents: StreamEvent[] = [
        { type: "chunk-received", streamId: 999 },
        { type: "stream-ended", streamId: 999, response: endResponse() },
        { type: "stream-errored", streamId: 999, error: "old" },
        { type: "finalize-complete", streamId: 999, ok: true },
      ];
      for (const event of staleEvents) {
        const result = step(state, event);
        expect(result.state).toBe(state);
        expect(result.commands).toEqual([]);
      }
    }
  });
});

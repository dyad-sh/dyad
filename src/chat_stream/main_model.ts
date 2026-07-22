import type {
  ChatStreamChunkPayload,
  ChatStreamEndPayload,
  ChatStreamErrorPayload,
  ChatStreamStartPayload,
  ChatStreamTransportEndPayload,
} from "./protocol";
import {
  CHAT_STREAM_INVARIANT_I1,
  CHAT_STREAM_INVARIANT_I2,
  CHAT_STREAM_INVARIANT_I3,
  CHAT_STREAM_INVARIANT_I4,
} from "./protocol";

/**
 * Pure executable model of the imperative main-process chat stream engine.
 *
 * Grounding uses upstream/main@d3e54bb36 (`chat_stream_handlers.ts`): handler
 * completion registration and controller tracking are collapsed into
 * `tracked` (lines 593-615), although validation failure can leave a
 * completions-only entry (599-610). Chat cancellation includes such entries
 * (335-344), while app cancellation selects only chats with a non-pending
 * controller (420-425); after a chat is selected it aborts all its controllers,
 * including pending ones (352-353). Those asymmetries are deliberate model
 * boundaries, not normalized behavior.
 *
 * Admission states model the loop at lines 645-700. The final barrier check,
 * pending-marker clear, and start emission (670-708) are one atomic action.
 * Streaming await points model abort observation at 2094 and 2124 plus the
 * post-check awaits at 2150-2207. Unwind/finalization models lines 2228-2265:
 * the outer catch can emit error while aborted, final transport-end is guarded,
 * and completion resolves before it is untracked.
 *
 * Unlike renderer machines this model returns emissions directly as commands:
 * it is a specification/test oracle, not a production command runner.
 */

export type MainStreamPhase =
  | "tracked"
  | "admission-pending"
  | "waiting-chat-barrier"
  | "waiting-app-barrier"
  | "admitted"
  | "streaming"
  | "unwinding-completed"
  | "unwinding-errored"
  | "unwinding-aborted"
  | "finalized";

export interface MainStream {
  id: number;
  chatId: number;
  appId: number;
  phase: MainStreamPhase;
  aborted: boolean;
  cancelNotified: boolean;
  chunkEmitted: boolean;
  awaitPoint:
    | "llm"
    | "compaction"
    | "post-abort-db"
    | "post-abort-apply"
    | null;
  completionResolved: boolean;
}

export interface MainModelState {
  streams: Readonly<Record<number, MainStream>>;
  chatBarrierCounts: Readonly<Record<number, number>>;
  appBarrierCounts: Readonly<Record<number, number>>;
  chatWaiters: Readonly<Record<number, readonly number[]>>;
  appWaiters: Readonly<Record<number, readonly number[]>>;
  pendingCompactionChats: readonly number[];
  quit: boolean;
}

export type BarrierScope =
  | { type: "chat"; chatId: number }
  | { type: "app"; appId: number };

export type MainModelEvent =
  | {
      type: "request-received";
      streamId: number;
      chatId: number;
      appId: number;
    }
  | { type: "handler-advanced"; streamId: number; applyError?: boolean }
  | { type: "barrier-installed"; scope: BarrierScope }
  | { type: "barrier-released"; scope: BarrierScope }
  | { type: "cancel-chat"; chatId: number }
  | { type: "cancel-app"; appId: number }
  | {
      type: "llm-settled";
      streamId: number;
      outcome: "completed" | "errored" | "aborted";
    }
  | { type: "compaction-started"; streamId: number }
  | { type: "compaction-finished"; streamId: number }
  | { type: "handler-unwound"; streamId: number }
  | { type: "quit" };

type EmissionOrigin = "admission" | "handler" | "cancel" | "finalizer";

export type MainModelEmission =
  | {
      type: "chat:stream:start";
      payload: ChatStreamStartPayload;
      origin: EmissionOrigin;
    }
  | {
      type: "chat:response:chunk";
      payload: ChatStreamChunkPayload;
      origin: EmissionOrigin;
    }
  | {
      type: "chat:response:end";
      payload: ChatStreamEndPayload;
      origin: EmissionOrigin;
    }
  | {
      type: "chat:response:error";
      payload: ChatStreamErrorPayload;
      origin: EmissionOrigin;
    }
  | {
      type: "chat:stream:end";
      payload: ChatStreamTransportEndPayload;
      origin: EmissionOrigin;
    }
  | { type: "completion-resolved"; streamId: number; origin: "finalizer" };

export interface MainModelTransitionResult {
  state: MainModelState;
  commands: readonly MainModelEmission[];
}

export const initialMainModelState: MainModelState = {
  streams: {},
  chatBarrierCounts: {},
  appBarrierCounts: {},
  chatWaiters: {},
  appWaiters: {},
  pendingCompactionChats: [],
  quit: false,
};

function countFor(scope: BarrierScope, state: MainModelState): number {
  return scope.type === "chat"
    ? (state.chatBarrierCounts[scope.chatId] ?? 0)
    : (state.appBarrierCounts[scope.appId] ?? 0);
}

function coveringBarrierCount(
  state: MainModelState,
  stream: MainStream,
): number {
  return (
    (state.chatBarrierCounts[stream.chatId] ?? 0) +
    (state.appBarrierCounts[stream.appId] ?? 0)
  );
}

function replaceStream(
  state: MainModelState,
  stream: MainStream,
): MainModelState {
  return { ...state, streams: { ...state.streams, [stream.id]: stream } };
}

function waiterRecord(
  waiters: Readonly<Record<number, readonly number[]>>,
  key: number,
  streamId: number,
): Readonly<Record<number, readonly number[]>> {
  const values = waiters[key] ?? [];
  if (values.includes(streamId)) return waiters;
  return { ...waiters, [key]: [...values, streamId] };
}

function cancelStreams(
  state: MainModelState,
  selected: (stream: MainStream) => boolean,
): MainModelTransitionResult {
  let next = state;
  const commands: MainModelEmission[] = [];
  for (const stream of Object.values(state.streams)) {
    if (
      !selected(stream) ||
      stream.phase === "finalized" ||
      stream.cancelNotified
    )
      continue;
    const wasWaiting =
      stream.phase === "waiting-chat-barrier" ||
      stream.phase === "waiting-app-barrier";
    const cancelled = {
      ...stream,
      aborted: true,
      cancelNotified: true,
      // The abort listener in waitForAdmissionBlockToClear (lines 284-308)
      // settles the parked await without waiting for barrier release.
      phase: wasWaiting ? ("unwinding-aborted" as const) : stream.phase,
    };
    next = replaceStream(next, cancelled);
    if (wasWaiting) {
      const remove = (
        waiters: Readonly<Record<number, readonly number[]>>,
      ): Readonly<Record<number, readonly number[]>> =>
        Object.fromEntries(
          Object.entries(waiters)
            .map(
              ([key, values]) =>
                [key, values.filter((id) => id !== stream.id)] as const,
            )
            .filter(([, values]) => values.length > 0),
        );
      next = {
        ...next,
        chatWaiters: remove(next.chatWaiters),
        appWaiters: remove(next.appWaiters),
      };
    }
    // cancelTrackedStreams lines 350-383: abort all selected controllers and
    // synchronously send the sole cancelled response end + transport end.
    commands.push(
      {
        type: "chat:response:end",
        payload: {
          chatId: stream.chatId,
          streamId: stream.id,
          updatedFiles: false,
          wasCancelled: true,
        },
        origin: "cancel",
      },
      {
        type: "chat:stream:end",
        payload: { chatId: stream.chatId },
        origin: "cancel",
      },
    );
  }
  return { state: next, commands };
}

function releaseBarrier(
  state: MainModelState,
  scope: BarrierScope,
): MainModelState {
  const counts =
    scope.type === "chat" ? state.chatBarrierCounts : state.appBarrierCounts;
  const key = scope.type === "chat" ? scope.chatId : scope.appId;
  const remaining = Math.max(0, (counts[key] ?? 0) - 1);
  const nextCounts = { ...counts };
  if (remaining === 0) delete nextCounts[key];
  else nextCounts[key] = remaining;
  let next: MainModelState =
    scope.type === "chat"
      ? { ...state, chatBarrierCounts: nextCounts }
      : { ...state, appBarrierCounts: nextCounts };
  if (remaining !== 0) return next;

  const waiters =
    scope.type === "chat" ? state.chatWaiters[key] : state.appWaiters[key];
  for (const streamId of waiters ?? []) {
    const stream = next.streams[streamId];
    if (stream && !stream.aborted && stream.phase.startsWith("waiting-")) {
      next = replaceStream(next, { ...stream, phase: "admission-pending" });
    }
  }
  const nextWaiters = {
    ...(scope.type === "chat" ? state.chatWaiters : state.appWaiters),
  };
  delete nextWaiters[key];
  return scope.type === "chat"
    ? { ...next, chatWaiters: nextWaiters }
    : { ...next, appWaiters: nextWaiters };
}

export function transitionMainModel(
  state: MainModelState,
  event: MainModelEvent,
): MainModelTransitionResult {
  if (state.quit && event.type !== "quit") return { state, commands: [] };

  switch (event.type) {
    case "request-received": {
      if (state.streams[event.streamId]) return { state, commands: [] };
      // Lines 593-615, before the first handler await at 629.
      return {
        state: replaceStream(state, {
          id: event.streamId,
          chatId: event.chatId,
          appId: event.appId,
          phase: "tracked",
          aborted: false,
          cancelNotified: false,
          chunkEmitted: false,
          awaitPoint: null,
          completionResolved: false,
        }),
        commands: [],
      };
    }
    case "handler-advanced": {
      const stream = state.streams[event.streamId];
      if (!stream || stream.phase === "finalized")
        return { state, commands: [] };
      if (
        stream.aborted &&
        [
          "tracked",
          "admission-pending",
          "waiting-chat-barrier",
          "waiting-app-barrier",
        ].includes(stream.phase)
      ) {
        return {
          state: replaceStream(state, {
            ...stream,
            phase: "unwinding-aborted",
            awaitPoint: null,
          }),
          commands: [],
        };
      }
      if (stream.phase === "tracked") {
        return {
          state: replaceStream(state, {
            ...stream,
            phase: "admission-pending",
          }),
          commands: [],
        };
      }
      if (stream.phase === "admission-pending") {
        if ((state.chatBarrierCounts[stream.chatId] ?? 0) > 0) {
          return {
            state: {
              ...replaceStream(state, {
                ...stream,
                phase: "waiting-chat-barrier",
              }),
              chatWaiters: waiterRecord(
                state.chatWaiters,
                stream.chatId,
                stream.id,
              ),
            },
            commands: [],
          };
        }
        if ((state.appBarrierCounts[stream.appId] ?? 0) > 0) {
          return {
            state: {
              ...replaceStream(state, {
                ...stream,
                phase: "waiting-app-barrier",
              }),
              appWaiters: waiterRecord(
                state.appWaiters,
                stream.appId,
                stream.id,
              ),
            },
            commands: [],
          };
        }
        // Lines 670-708: check + marker clear + start send are atomic.
        const admitted = { ...stream, phase: "admitted" as const };
        return {
          state: replaceStream(state, admitted),
          commands: [
            {
              type: "chat:stream:start",
              payload: { chatId: stream.chatId, streamId: stream.id },
              origin: "admission",
            },
          ],
        };
      }
      if (stream.phase === "admitted") {
        // The first modeled body await begins streaming and may produce a chunk.
        return {
          state: replaceStream(state, {
            ...stream,
            phase: "streaming",
            awaitPoint: "llm",
            chunkEmitted: true,
          }),
          commands: [
            {
              type: "chat:response:chunk",
              payload: { chatId: stream.chatId, streamId: stream.id },
              origin: "handler",
            },
          ],
        };
      }
      if (
        stream.phase === "streaming" &&
        stream.awaitPoint === "post-abort-db"
      ) {
        return {
          state: replaceStream(state, {
            ...stream,
            awaitPoint: "post-abort-apply",
          }),
          commands: [],
        };
      }
      if (
        stream.phase === "streaming" &&
        stream.awaitPoint === "post-abort-apply"
      ) {
        // Lines 2197-2222: apply error + response end is legal; a cancel may
        // have landed after the guard at line 2144.
        return {
          state: replaceStream(state, {
            ...stream,
            phase: "unwinding-completed",
            awaitPoint: null,
          }),
          commands: [
            ...(event.applyError
              ? ([
                  {
                    type: "chat:response:error",
                    payload: {
                      chatId: stream.chatId,
                      streamId: stream.id,
                      error: "modeled apply error",
                    },
                    origin: "handler",
                  },
                ] satisfies MainModelEmission[])
              : []),
            {
              type: "chat:response:end",
              payload: {
                chatId: stream.chatId,
                streamId: stream.id,
                updatedFiles: false,
              },
              origin: "handler",
            },
          ],
        };
      }
      return { state, commands: [] };
    }
    case "barrier-installed": {
      const counts =
        event.scope.type === "chat"
          ? state.chatBarrierCounts
          : state.appBarrierCounts;
      const key =
        event.scope.type === "chat" ? event.scope.chatId : event.scope.appId;
      const nextCounts = { ...counts, [key]: (counts[key] ?? 0) + 1 };
      return {
        state:
          event.scope.type === "chat"
            ? { ...state, chatBarrierCounts: nextCounts }
            : { ...state, appBarrierCounts: nextCounts },
        commands: [],
      };
    }
    case "barrier-released":
      return countFor(event.scope, state) === 0
        ? { state, commands: [] }
        : { state: releaseBarrier(state, event.scope), commands: [] };
    case "cancel-chat":
      return cancelStreams(state, (stream) => stream.chatId === event.chatId);
    case "cancel-app": {
      // Lines 420-425 select chats at chat granularity when any controller is
      // non-pending, then cancelTrackedStreams aborts every controller in them.
      const selectedChats = new Set(
        Object.values(state.streams)
          .filter(
            (stream) =>
              stream.appId === event.appId &&
              ![
                "tracked",
                "admission-pending",
                "waiting-chat-barrier",
                "waiting-app-barrier",
                "finalized",
              ].includes(stream.phase),
          )
          .map((stream) => stream.chatId),
      );
      return cancelStreams(state, (stream) => selectedChats.has(stream.chatId));
    }
    case "llm-settled": {
      const stream = state.streams[event.streamId];
      if (
        !stream ||
        stream.phase !== "streaming" ||
        stream.awaitPoint !== "llm"
      )
        return { state, commands: [] };
      if (event.outcome === "completed") {
        return {
          state: replaceStream(state, {
            ...stream,
            awaitPoint: "post-abort-db",
          }),
          commands: [],
        };
      }
      const phase =
        event.outcome === "errored" ? "unwinding-errored" : "unwinding-aborted";
      return {
        state: replaceStream(state, { ...stream, phase, awaitPoint: null }),
        commands:
          event.outcome === "errored"
            ? [
                {
                  type: "chat:response:error",
                  payload: {
                    chatId: stream.chatId,
                    streamId: stream.id,
                    error: "modeled handler error",
                  },
                  origin: "handler",
                },
              ]
            : [],
      };
    }
    case "compaction-started": {
      const stream = state.streams[event.streamId];
      if (
        !stream ||
        stream.phase !== "streaming" ||
        stream.awaitPoint !== "llm"
      )
        return { state, commands: [] };
      return {
        state: {
          ...replaceStream(state, { ...stream, awaitPoint: "compaction" }),
          pendingCompactionChats: state.pendingCompactionChats.includes(
            stream.chatId,
          )
            ? state.pendingCompactionChats
            : [...state.pendingCompactionChats, stream.chatId],
        },
        commands: [],
      };
    }
    case "compaction-finished": {
      const stream = state.streams[event.streamId];
      if (
        !stream ||
        stream.phase !== "streaming" ||
        stream.awaitPoint !== "compaction"
      )
        return { state, commands: [] };
      return {
        state: replaceStream(state, { ...stream, awaitPoint: "llm" }),
        commands: [],
      };
    }
    case "handler-unwound": {
      const stream = state.streams[event.streamId];
      if (!stream || !stream.phase.startsWith("unwinding-"))
        return { state, commands: [] };
      const finalized = {
        ...stream,
        phase: "finalized" as const,
        completionResolved: true,
      };
      const commands: MainModelEmission[] = [];
      // Lines 2246-2265: aborted handlers skip transport-end; completion then resolves.
      if (!stream.aborted) {
        commands.push({
          type: "chat:stream:end",
          payload: { chatId: stream.chatId },
          origin: "finalizer",
        });
      }
      commands.push({
        type: "completion-resolved",
        streamId: stream.id,
        origin: "finalizer",
      });
      return { state: replaceStream(state, finalized), commands };
    }
    case "quit": {
      if (state.quit) return { state, commands: [] };
      const streams = Object.fromEntries(
        Object.values(state.streams).map((stream) => [
          stream.id,
          {
            ...stream,
            aborted: true,
            phase: "finalized" as const,
            completionResolved: true,
            awaitPoint: null,
          },
        ]),
      );
      // Lines 554-574: quit aborts and clears tracking/barriers/waiters without renderer terminals.
      return {
        state: {
          ...state,
          streams,
          chatBarrierCounts: {},
          appBarrierCounts: {},
          chatWaiters: {},
          appWaiters: {},
          quit: true,
        },
        commands: [],
      };
    }
  }
}

/** Executable transition-scoped assertions for protocol invariants I1-I3. */
export function assertMainModelTransitionInvariants(
  previous: MainModelState,
  event: MainModelEvent,
  result: MainModelTransitionResult,
): void {
  for (const emission of result.commands) {
    if (emission.type === "chat:stream:start") {
      const stream = result.state.streams[emission.payload.streamId ?? -1];
      if (!stream || coveringBarrierCount(previous, stream) > 0) {
        throw new Error(
          `${CHAT_STREAM_INVARIANT_I1}: admission fired under a covering barrier`,
        );
      }
      if (stream.cancelNotified) {
        throw new Error(
          `${CHAT_STREAM_INVARIANT_I3}: an early-notified stream was admitted`,
        );
      }
    }
    if (
      emission.type === "chat:response:end" &&
      emission.payload.wasCancelled === true &&
      emission.origin !== "cancel"
    ) {
      throw new Error(
        `${CHAT_STREAM_INVARIANT_I2}: wasCancelled was emitted outside the cancel action`,
      );
    }
    if (
      emission.type === "chat:stream:end" &&
      emission.origin === "finalizer"
    ) {
      const stream =
        event.type === "handler-unwound"
          ? result.state.streams[event.streamId]
          : undefined;
      if (stream?.aborted)
        throw new Error(
          `${CHAT_STREAM_INVARIANT_I2}: finalized emitted transport end for an aborted stream`,
        );
    }
  }
}

/** Executable quiescence assertion for invariant I4. */
export function assertMainModelQuiescence(state: MainModelState): void {
  if (
    Object.keys(state.chatBarrierCounts).length > 0 ||
    Object.keys(state.appBarrierCounts).length > 0
  ) {
    throw new Error(
      `${CHAT_STREAM_INVARIANT_I4}: released scenario finished with non-empty barrier counts`,
    );
  }
  if (
    Object.values(state.streams).some((stream) =>
      stream.phase.startsWith("waiting-"),
    )
  ) {
    throw new Error(
      `${CHAT_STREAM_INVARIANT_I4}: released scenario left a stream parked on a barrier`,
    );
  }
  if (
    Object.keys(state.chatWaiters).length > 0 ||
    Object.keys(state.appWaiters).length > 0
  ) {
    throw new Error(
      `${CHAT_STREAM_INVARIANT_I4}: released scenario left admission waiters registered`,
    );
  }
}

export function mainModelStateKey(state: MainModelState): string {
  return JSON.stringify(state);
}

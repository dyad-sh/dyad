import type { createStore } from "jotai";

import {
  chatErrorByIdAtom,
  isStreamingByIdAtom,
  queuePausedByIdAtom,
  queuedMessagesByIdAtom,
} from "@/atoms/chatAtoms";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { createTraceObserver } from "@/state_machines/trace";
import {
  registerAtomWriter,
  type AtomProjectionWriter,
} from "@/state_machines/projection";

import {
  createProductionChatStreamCommands,
  type ChatStreamRuntimeDeps,
} from "./commands";
import {
  createChatStreamController,
  type ChatStreamController,
} from "./controller";
import type { StreamCommand, StreamEvent, StreamState } from "./state";

type JotaiStore = ReturnType<typeof createStore>;

export interface StreamFinishedEvent {
  chatId: number;
  streamId: number;
  outcome: "completed" | "cancelled" | "errored";
}

type StreamFinishedListener = (event: StreamFinishedEvent) => void;

function withoutChatId<Value>(
  previous: Map<number, Value>,
  chatId: number,
): Map<number, Value> {
  if (!previous.has(chatId)) return previous;
  const next = new Map(previous);
  next.delete(chatId);
  return next;
}

/**
 * Constructed owner for every per-chat stream controller and its adapter.
 *
 * Terminal, settled controllers self-release once only the host subscription
 * remains. This is the intentional release path for idle chats that are never
 * deleted; their last generation is retained so replacement controllers do
 * not reuse IDs while delayed IPC events may still be in flight. Deleted chats
 * are disposed explicitly through `disposeKey`.
 */
export class ChatStreamManager {
  private runtimeDeps: ChatStreamRuntimeDeps | null = null;
  private readonly lastStreamIdByChatId = new Map<number, number>();
  private readonly streamFinishedListeners = new Set<StreamFinishedListener>();
  private readonly commands;
  private readonly host: KeyedControllerHost<number, ChatStreamController>;
  private projectionWriter: AtomProjectionWriter<unknown> | null = null;

  constructor(private readonly store: JotaiStore) {
    this.commands = createProductionChatStreamCommands(
      () => {
        if (!this.runtimeDeps) {
          throw new Error(
            "Chat stream runtime deps not registered. Mount useChatStreamRuntime() before streaming.",
          );
        }
        return this.runtimeDeps;
      },
      (update) => this.writeProjection(update),
    );
    this.host = new KeyedControllerHost((chatId) =>
      this.createController(chatId),
    );
  }

  start(): void {
    this.ensureProjectionWriter();
  }

  registerRuntimeDeps(deps: ChatStreamRuntimeDeps): void {
    this.runtimeDeps = deps;
  }

  ensure(chatId: number): ChatStreamController {
    return this.host.ensure(chatId);
  }

  peek(chatId: number): ChatStreamController | undefined {
    return this.host.get(chatId);
  }

  notifyStreamRegistered(chatId: number, streamId?: number): void {
    this.host.get(chatId)?.send({ type: "registered", streamId });
  }

  subscribeStreamFinished(listener: StreamFinishedListener): () => void {
    this.streamFinishedListeners.add(listener);
    return () => {
      this.streamFinishedListeners.delete(listener);
    };
  }

  disposeKey = (chatId: number): void => {
    this.host.disposeKey(chatId);
    this.lastStreamIdByChatId.delete(chatId);
    this.store.set(queuedMessagesByIdAtom, (previous) =>
      withoutChatId(previous, chatId),
    );
    this.store.set(queuePausedByIdAtom, (previous) =>
      withoutChatId(previous, chatId),
    );
    this.store.set(chatErrorByIdAtom, (previous) =>
      withoutChatId(previous, chatId),
    );
    this.writeProjection((previous: Map<number, boolean>) =>
      withoutChatId(previous, chatId),
    );
  };

  dispose(): void {
    this.host.dispose();
    this.projectionWriter?.dispose();
    this.projectionWriter = null;
    this.streamFinishedListeners.clear();
    // An in-flight startStream may register its IPC transport after an await.
    // Its controller releases again once setup settles, so retain deps until
    // that promise releases this otherwise-unreferenced manager graph.
  }

  private writeProjection(value: unknown): void {
    this.ensureProjectionWriter().write(value);
  }

  private ensureProjectionWriter(): AtomProjectionWriter<unknown> {
    this.projectionWriter ??= registerAtomWriter(
      this.store,
      isStreamingByIdAtom,
    );
    return this.projectionWriter;
  }

  private createController(chatId: number): ChatStreamController {
    const traceObserver = createTraceObserver<
      StreamState,
      StreamEvent,
      StreamCommand
    >("chat_stream", chatId, {
      mute: (event) => event.type === "chunk-received",
    });
    return createChatStreamController({
      chatId,
      initialLastStreamId: this.lastStreamIdByChatId.get(chatId),
      getCommands: () => this.commands,
      onQuiescent: (controller) => this.releaseIfQuiescent(controller),
      observer: {
        onTransitionApplied: (transition) => {
          traceObserver.onTransitionApplied?.(transition);
          this.notifyStreamFinished(
            chatId,
            transition.previous,
            transition.event,
            transition.state,
          );
        },
        onEventIgnored: (event) => traceObserver.onEventIgnored?.(event),
      },
    });
  }

  private notifyStreamFinished(
    chatId: number,
    previous: StreamState,
    event: StreamEvent,
    state: StreamState,
  ): void {
    let finished: StreamFinishedEvent | undefined;

    if (previous.type === "finalizing" && state.type === "idle") {
      finished = {
        chatId,
        streamId: previous.streamId,
        outcome: previous.wasCancelled ? "cancelled" : "completed",
      };
    } else if (
      state.type === "errored" &&
      previous.type !== "idle" &&
      previous.type !== "errored" &&
      event.type === "stream-errored"
    ) {
      finished = {
        chatId,
        streamId: event.streamId,
        outcome: "errored",
      };
    }

    if (!finished) return;

    // Controller observers run before the snapshot is committed. Defer the
    // one-shot signal so callbacks that submit another turn see the terminal
    // idle/errored state instead of re-entering the previous transition.
    queueMicrotask(() => {
      for (const listener of this.streamFinishedListeners) {
        try {
          listener(finished);
        } catch (error) {
          console.error(
            "[chat-stream] Stream-finished listener failed:",
            error,
          );
        }
      }
    });
  }

  private releaseIfQuiescent(controller: ChatStreamController): void {
    const snapshot = controller.getSnapshot();
    if (
      this.host.get(controller.chatId) === controller &&
      (snapshot.type === "idle" || snapshot.type === "errored") &&
      controller.isSettled() &&
      controller.subscriberCount() <= 1
    ) {
      this.lastStreamIdByChatId.set(controller.chatId, snapshot.lastStreamId);
      this.host.disposeKey(controller.chatId);
    }
  }
}

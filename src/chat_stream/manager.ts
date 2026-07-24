import type { createStore } from "jotai";

import {
  chatErrorByIdAtom,
  isStreamingByIdAtom,
  queuePausedByIdAtom,
  queuedMessagesByIdAtom,
} from "@/atoms/chatAtoms";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { uuidIdSource, type IdSource } from "@/state_machines/clock";
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
import type {
  ChatStreamInvocationRef,
  StreamCommand,
  StreamEvent,
  StreamState,
} from "./state";
import type { UserInputFollowUpQueueOwner } from "@/state_machines/handoff_types";

type JotaiStore = ReturnType<typeof createStore>;

export interface StreamFinishedEvent {
  chatId: number;
  invocationRef: ChatStreamInvocationRef;
  outcome: "completed" | "cancelled" | "errored";
}

type StreamFinishedListener = (event: StreamFinishedEvent) => void;

export interface ChatStreamUserInputHandoffFacade {
  reject(
    owner: UserInputFollowUpQueueOwner,
    reason: string,
  ): void | Promise<void>;
}

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
 * remains. Globally unique operation IDs allow terminal controllers to be
 * released without retaining per-chat generation state across lifetimes.
 * Deleted chats are disposed explicitly through `disposeKey`.
 */
export class ChatStreamManager {
  private runtimeDeps: ChatStreamRuntimeDeps | null = null;
  private readonly streamFinishedListeners = new Set<StreamFinishedListener>();
  private readonly commands;
  private readonly host: KeyedControllerHost<number, ChatStreamController>;
  private projectionWriter: AtomProjectionWriter<unknown> | null = null;
  private projectionEnabled = true;
  private userInputHandoff: ChatStreamUserInputHandoffFacade | null = null;

  constructor(
    private readonly store: JotaiStore,
    private readonly idSource: IdSource = uuidIdSource,
  ) {
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
    this.projectionEnabled = true;
    this.ensureProjectionWriter();
  }

  stop(): void {
    this.projectionEnabled = false;
    this.projectionWriter?.dispose();
    this.projectionWriter = null;
  }

  registerRuntimeDeps(deps: ChatStreamRuntimeDeps): void {
    this.runtimeDeps = deps;
  }

  configureUserInputHandoff(facade: ChatStreamUserInputHandoffFacade): void {
    this.userInputHandoff = facade;
  }

  rejectUserInputHandoff(
    owner: UserInputFollowUpQueueOwner,
    reason: string,
  ): Promise<void> {
    if (!this.userInputHandoff) {
      return Promise.reject(
        new Error("User-input handoff facade is not configured"),
      );
    }
    return Promise.resolve(this.userInputHandoff.reject(owner, reason));
  }

  ensure(chatId: number): ChatStreamController {
    return this.host.ensure(chatId);
  }

  peek(chatId: number): ChatStreamController | undefined {
    return this.host.get(chatId);
  }

  notifyStreamRegistered(
    chatId: number,
    invocationRef?: ChatStreamInvocationRef,
  ): void {
    this.host.get(chatId)?.send({ type: "registered", invocationRef });
  }

  subscribeStreamFinished(listener: StreamFinishedListener): () => void {
    this.streamFinishedListeners.add(listener);
    return () => {
      this.streamFinishedListeners.delete(listener);
    };
  }

  disposeKey = (chatId: number): void => {
    this.host.disposeKey(chatId);
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
    this.stop();
    this.host.dispose();
    this.streamFinishedListeners.clear();
    // An in-flight startStream may register its IPC transport after an await.
    // Its controller releases again once setup settles, so retain deps until
    // that promise releases this otherwise-unreferenced manager graph.
  }

  private writeProjection(value: unknown): void {
    if (!this.projectionEnabled) return;
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
      idSource: this.idSource,
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
        invocationRef: previous.invocationRef,
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
        invocationRef: event.invocationRef,
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
      this.host.disposeKey(controller.chatId);
    }
  }
}

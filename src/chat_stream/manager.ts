import type { createStore } from "jotai";

import { queuePausedByIdAtom, queuedMessagesByIdAtom } from "@/atoms/chatAtoms";
import { chatAttachmentToFileAttachment } from "@/lib/attachment_conversion";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { uuidIdSource, type IdSource } from "@/state_machines/clock";
import { createTraceObserver } from "@/state_machines/trace";
import {
  createLifecycleScope,
  type LifecycleScope,
} from "@/state_machines/lifecycle_scope";
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
import { ChatStreamPreviewStore } from "./preview_store";
import {
  isStreamActive,
  selectCanSubmitImmediately,
  selectStreamError,
} from "./transition";
import type { QueueMutationWithoutRevision } from "./remote_manager";

type JotaiStore = ReturnType<typeof createStore>;

export interface StreamFinishedEvent {
  chatId: number;
  invocationRef: ChatStreamInvocationRef;
  outcome: "completed" | "cancelled" | "errored";
  chatSummary?: string;
}

type StreamFinishedListener = (event: StreamFinishedEvent) => void;
type StreamDisposedListener = () => void;

const MAX_RETAINED_STREAM_ERRORS = 100;
const IDLE_STREAM_STATE = { type: "idle" } as const;

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
  private runtimeDeps: Omit<ChatStreamRuntimeDeps, "getIsStreaming"> | null =
    null;
  private readonly streamFinishedListeners = new Set<StreamFinishedListener>();
  private readonly streamDisposedListeners = new Map<
    number,
    Set<StreamDisposedListener>
  >();
  private readonly lastErrorByChatId = new Map<number, string>();
  private readonly commands;
  private readonly host: KeyedControllerHost<number, ChatStreamController>;
  private readonly lifecycle: LifecycleScope;
  private readonly previews = new ChatStreamPreviewStore();

  constructor(
    private readonly store: JotaiStore,
    private readonly idSource: IdSource = uuidIdSource,
  ) {
    this.commands = createProductionChatStreamCommands(() => {
      if (!this.runtimeDeps) {
        throw new Error(
          "Chat stream runtime deps not registered. Mount useChatStreamRuntime() before streaming.",
        );
      }
      return {
        ...this.runtimeDeps,
        getIsStreaming: (chatId) => this.getIsStreaming(chatId),
      };
    }, this.setPreview);
    this.host = new KeyedControllerHost((chatId) =>
      this.createController(chatId),
    );
    this.lifecycle = createLifecycleScope({
      stopAdmission: () => undefined,
      settleWaiters: () => this.host.dispose(),
      publishFinalProjection: () => undefined,
      releaseResources: () => {
        this.streamFinishedListeners.clear();
        this.streamDisposedListeners.clear();
        this.lastErrorByChatId.clear();
      },
      onLateSettlement: () => undefined,
    });
  }

  registerRuntimeDeps(
    deps: Omit<ChatStreamRuntimeDeps, "getIsStreaming">,
  ): void {
    this.runtimeDeps = deps;
  }

  ensure(chatId: number): ChatStreamController {
    return this.host.ensure(chatId);
  }

  peek(chatId: number): ChatStreamController | undefined {
    return this.host.get(chatId);
  }

  getIsStreaming(chatId: number): boolean {
    return isStreamActive(
      this.host.get(chatId)?.getSnapshot() ?? IDLE_STREAM_STATE,
    );
  }

  isIdle(chatId: number): boolean {
    return selectCanSubmitImmediately(
      this.host.get(chatId)?.getSnapshot() ?? IDLE_STREAM_STATE,
    );
  }

  watchIdle(chatId: number, callback: () => void): () => void {
    let settled = false;
    let cancelled = false;
    let deliveryPending = false;
    let unsubscribeFinished: () => void = () => {};
    let unsubscribeDisposal: () => void = () => {};

    const detach = () => {
      unsubscribeFinished();
      unsubscribeDisposal();
    };
    const scheduleDelivery = () => {
      if (settled || cancelled || deliveryPending) return;
      deliveryPending = true;
      queueMicrotask(() => {
        deliveryPending = false;
        if (cancelled || settled) return;
        if (!this.isIdle(chatId)) return;
        settled = true;
        detach();
        try {
          callback();
        } catch (error) {
          console.error("[chat-stream] Idle watcher failed:", error);
        }
      });
    };

    const idleBeforeSubscribe = this.isIdle(chatId);

    unsubscribeFinished = this.subscribeStreamFinished((event) => {
      if (event.chatId === chatId) scheduleDelivery();
    });
    unsubscribeDisposal = this.subscribeDisposed(chatId, scheduleDelivery);

    if (idleBeforeSubscribe || this.isIdle(chatId)) scheduleDelivery();

    return () => {
      cancelled = true;
      detach();
    };
  }

  /**
   * Legacy renderer-hosted queue adapter used only by cutover test harnesses.
   * Production queue mutations are revisioned commands on the main actor.
   */
  async dispatchQueueEvent(
    chatId: number,
    event: QueueMutationWithoutRevision,
  ): Promise<void> {
    if (event.type === "PAUSE_QUEUE" || event.type === "RESUME_QUEUE") {
      this.store.set(queuePausedByIdAtom, (previous) => {
        const next = new Map(previous);
        if (event.type === "PAUSE_QUEUE") next.set(chatId, true);
        else next.delete(chatId);
        return next;
      });
      if (event.type === "RESUME_QUEUE") {
        this.host.get(chatId)?.send({ type: "queue-poked" });
      }
      return;
    }

    this.store.set(queuedMessagesByIdAtom, (previous) => {
      const current = previous.get(chatId) ?? [];
      let queue = current;
      switch (event.type) {
        case "EDIT_QUEUE_ENTRY":
          queue = current.map((item) =>
            item.id === event.itemId
              ? {
                  ...item,
                  prompt: event.prompt,
                  attachments: event.attachments?.map(
                    chatAttachmentToFileAttachment,
                  ),
                  selectedComponents: event.selectedComponents,
                }
              : item,
          );
          break;
        case "REMOVE_QUEUE_ENTRY":
          queue = current.filter((item) => item.id !== event.itemId);
          break;
        case "REORDER_QUEUE_ENTRY": {
          const fromIndex = current.findIndex(
            (item) => item.id === event.itemId,
          );
          if (fromIndex < 0) break;
          queue = [...current];
          const [item] = queue.splice(fromIndex, 1);
          queue.splice(
            Math.max(0, Math.min(event.toIndex, queue.length)),
            0,
            item,
          );
          break;
        }
        case "CLEAR_QUEUE":
          queue = [];
          break;
      }
      if (queue === current) return previous;
      const next = new Map(previous);
      if (queue.length === 0) next.delete(chatId);
      else next.set(chatId, queue);
      return next;
    });
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

  getPreviewSnapshot = this.previews.getSnapshot;

  subscribePreview = this.previews.subscribeKey;

  /** Command-adapter write boundary for the high-frequency preview sidecar. */
  setPreview = (chatId: number, content: string): boolean =>
    this.previews.set(chatId, content);

  disposeKey = (chatId: number): void => {
    this.host.disposeKey(chatId);
    this.previews.disposeKey(chatId);
    this.notifyDisposed(chatId);
    this.store.set(queuedMessagesByIdAtom, (previous) =>
      withoutChatId(previous, chatId),
    );
    this.store.set(queuePausedByIdAtom, (previous) =>
      withoutChatId(previous, chatId),
    );
    this.lastErrorByChatId.delete(chatId);
  };

  dispose(): void {
    const chatIds = this.host.keys();
    for (const chatId of chatIds) this.notifyDisposed(chatId);
    this.lifecycle.dispose();
    this.previews.dispose();
    // An in-flight startStream may register its IPC transport after an await.
    // Its controller releases again once setup settles, so retain deps until
    // that promise releases this otherwise-unreferenced manager graph.
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
      initialState: this.lastErrorByChatId.has(chatId)
        ? { type: "errored", error: this.lastErrorByChatId.get(chatId)! }
        : IDLE_STREAM_STATE,
      onQuiescent: (controller) => this.releaseIfQuiescent(controller),
      observer: {
        onTransitionApplied: (transition) => {
          traceObserver.onTransitionApplied?.(transition);
          const error = selectStreamError(transition.state);
          if (error !== null) {
            this.rememberError(chatId, error);
          } else if (
            transition.event.type === "submit" &&
            transition.state.type === "starting"
          ) {
            this.lastErrorByChatId.delete(chatId);
          }
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

    if (
      previous.type === "finalizing" &&
      (state.type === "idle" || state.type === "errored")
    ) {
      finished = {
        chatId,
        invocationRef: previous.invocationRef,
        outcome:
          state.type === "errored"
            ? "errored"
            : previous.wasCancelled
              ? "cancelled"
              : "completed",
        ...(previous.chatSummary === undefined
          ? {}
          : { chatSummary: previous.chatSummary }),
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
      this.notifyDisposed(controller.chatId);
    }
  }

  private rememberError(chatId: number, error: string): void {
    this.lastErrorByChatId.delete(chatId);
    this.lastErrorByChatId.set(chatId, error);
    while (this.lastErrorByChatId.size > MAX_RETAINED_STREAM_ERRORS) {
      const oldestChatId = this.lastErrorByChatId.keys().next().value;
      if (oldestChatId === undefined) break;
      this.lastErrorByChatId.delete(oldestChatId);
    }
  }

  private subscribeDisposed(
    chatId: number,
    listener: StreamDisposedListener,
  ): () => void {
    let listeners = this.streamDisposedListeners.get(chatId);
    if (!listeners) {
      listeners = new Set();
      this.streamDisposedListeners.set(chatId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.streamDisposedListeners.delete(chatId);
      }
    };
  }

  private notifyDisposed(chatId: number): void {
    const listeners = [...(this.streamDisposedListeners.get(chatId) ?? [])];
    for (const listener of listeners) listener();
  }
}

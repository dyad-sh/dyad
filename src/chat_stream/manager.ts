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
  createProductionChatStreamCommands,
  type ChatStreamRuntimeDeps,
} from "./commands";
import {
  createChatStreamController,
  type ChatStreamController,
} from "./controller";

type JotaiStore = ReturnType<typeof createStore>;

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
 * are disposed explicitly through `disposeChat`.
 */
export class ChatStreamManager {
  private runtimeDeps: ChatStreamRuntimeDeps | null = null;
  private readonly lastStreamIdByChatId = new Map<number, number>();
  private readonly commands = createProductionChatStreamCommands(() => {
    if (!this.runtimeDeps) {
      throw new Error(
        "Chat stream runtime deps not registered. Mount useChatStreamRuntime() before streaming.",
      );
    }
    return this.runtimeDeps;
  });
  private readonly host = new KeyedControllerHost<number, ChatStreamController>(
    (chatId) =>
      createChatStreamController({
        chatId,
        initialLastStreamId: this.lastStreamIdByChatId.get(chatId),
        getCommands: () => this.commands,
        onQuiescent: (controller) => this.releaseIfQuiescent(controller),
        observer: createTraceObserver("chat_stream", chatId, {
          mute: (event) => event.type === "chunk-received",
        }),
      }),
  );

  constructor(private readonly store: JotaiStore) {}

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

  disposeChat(chatId: number): void {
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
    this.store.set(isStreamingByIdAtom, (previous) =>
      withoutChatId(previous, chatId),
    );
  }

  dispose(): void {
    this.host.dispose();
    // An in-flight startStream may register its IPC transport after an await.
    // Its controller releases again once setup settles, so retain deps until
    // that promise releases this otherwise-unreferenced manager graph.
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

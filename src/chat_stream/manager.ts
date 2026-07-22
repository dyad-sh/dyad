import type { createStore } from "jotai";

import {
  chatErrorByIdAtom,
  isStreamingByIdAtom,
  queuePausedByIdAtom,
  queuedMessagesByIdAtom,
} from "@/atoms/chatAtoms";
import { KeyedControllerHost } from "@/state_machines/keyed_host";

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
 * deleted; deleted chats are disposed explicitly through `disposeChat`.
 */
export class ChatStreamManager {
  private runtimeDeps: ChatStreamRuntimeDeps | null = null;
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
        getCommands: () => this.commands,
        onQuiescent: (controller) => this.releaseIfQuiescent(controller),
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

  notifyStreamRegistered(chatId: number): void {
    this.host.get(chatId)?.send({ type: "registered" });
  }

  disposeChat(chatId: number): void {
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
    const snapshotType = controller.getSnapshot().type;
    if (
      this.host.get(controller.chatId) === controller &&
      (snapshotType === "idle" || snapshotType === "errored") &&
      controller.isSettled() &&
      controller.subscriberCount() <= 1
    ) {
      this.host.disposeKey(controller.chatId);
    }
  }
}

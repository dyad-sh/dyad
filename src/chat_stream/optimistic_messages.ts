import type { Message } from "@/ipc/types";
import { SnapshotStore } from "@/state_machines/snapshot_store";
import { buildDyadAttachmentTag } from "../../shared/dyadAttachment";
import type { StreamRequest } from "./renderer_facade";

interface OptimisticMessage {
  intentId: string;
  message: Message;
  acceptedMessageId?: number;
  objectUrls: string[];
}

const EMPTY_MESSAGES: readonly OptimisticMessage[] = [];

/** Window-local display only. Main still owns acceptance and persisted history. */
export class OptimisticChatMessages {
  private readonly store = new SnapshotStore<
    ReadonlyMap<number, readonly OptimisticMessage[]>
  >(new Map());
  private nextMessageId = -1;
  private disposed = false;

  subscribe = this.store.subscribe;
  getSnapshot = (chatId: number | null): readonly OptimisticMessage[] =>
    (chatId === null ? undefined : this.store.getSnapshot().get(chatId)) ??
    EMPTY_MESSAGES;

  add(intentId: string, request: StreamRequest): void {
    if (this.disposed) return;
    const objectUrls: string[] = [];
    const attachmentInfo = (request.attachments ?? [])
      .map(({ file, type }) => {
        const url = URL.createObjectURL(file);
        objectUrls.push(url);
        return buildDyadAttachmentTag({
          name: file.name,
          type: file.type,
          url,
          path: "",
          attachmentType: type,
        });
      })
      .join("");
    this.set(request.chatId, [
      ...this.getSnapshot(request.chatId),
      {
        intentId,
        message: {
          id: this.nextMessageId--,
          role: "user",
          content:
            (request.optimisticDisplayContent ?? request.prompt) +
            attachmentInfo,
        },
        objectUrls,
      },
    ]);
  }

  accept(chatId: number, intentId: string, acceptedMessageId: number): void {
    if (!this.getSnapshot(chatId).some((entry) => entry.intentId === intentId))
      return;
    this.set(
      chatId,
      this.getSnapshot(chatId).map((entry) =>
        entry.intentId === intentId ? { ...entry, acceptedMessageId } : entry,
      ),
    );
  }

  remove(chatId: number, intentId: string): void {
    this.retain(chatId, (entry) => entry.intentId !== intentId);
  }

  reconcile(messagesByChat: ReadonlyMap<number, Message[]>): void {
    for (const chatId of this.store.getSnapshot().keys()) {
      const messages = messagesByChat.get(chatId);
      if (!messages) continue;
      const ids = new Set(messages.map((message) => message.id));
      const intents = new Set(
        messages.map((message) => message.chatTurnIntentId),
      );
      this.retain(
        chatId,
        (entry) =>
          !intents.has(entry.intentId) &&
          (entry.acceptedMessageId === undefined ||
            !ids.has(entry.acceptedMessageId)),
      );
    }
  }

  disposeKey(chatId: number): void {
    this.retain(chatId, () => false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const chatId of this.store.getSnapshot().keys())
      this.disposeKey(chatId);
    this.store.dispose();
  }

  private retain(
    chatId: number,
    predicate: (entry: OptimisticMessage) => boolean,
  ): void {
    const entries = this.getSnapshot(chatId);
    const retained = entries.filter((entry) => {
      if (predicate(entry)) return true;
      for (const url of entry.objectUrls) URL.revokeObjectURL(url);
      return false;
    });
    if (retained.length !== entries.length) this.set(chatId, retained);
  }

  private set(chatId: number, entries: readonly OptimisticMessage[]): void {
    const next = new Map(this.store.getSnapshot());
    if (entries.length) next.set(chatId, entries);
    else next.delete(chatId);
    this.store.setState(next);
  }
}

import { SnapshotStore } from "@/state_machines/snapshot_store";

const EMPTY_PREVIEW = "";

/** High-frequency per-chat content sidecar, separate from StreamState. */
export class ChatStreamPreviewStore {
  private readonly stores = new Map<number, SnapshotStore<string>>();
  private disposed = false;

  getSnapshot = (chatId: number): string =>
    this.stores.get(chatId)?.getSnapshot() ?? EMPTY_PREVIEW;

  subscribeKey = (chatId: number, listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    return this.ensure(chatId).subscribe(listener);
  };

  set(chatId: number, content: string): boolean {
    if (this.disposed) return false;
    if (content === EMPTY_PREVIEW && !this.stores.has(chatId)) return false;
    return this.ensure(chatId).setState(content);
  }

  clear(chatId: number): boolean {
    return this.set(chatId, EMPTY_PREVIEW);
  }

  disposeKey(chatId: number): void {
    this.stores.get(chatId)?.dispose();
    this.stores.delete(chatId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
  }

  private ensure(chatId: number): SnapshotStore<string> {
    let store = this.stores.get(chatId);
    if (!store) {
      store = new SnapshotStore(EMPTY_PREVIEW);
      this.stores.set(chatId, store);
    }
    return store;
  }
}

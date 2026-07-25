import type { ConsoleEntry } from "@/ipc/types";
import { createPreviewConsoleTail } from "@/lib/preview_console_buffer";
import { KeyedControllerHost } from "@/state_machines/keyed_host";
import { SnapshotStore } from "@/state_machines/snapshot_store";

const EMPTY_ENTRIES: readonly ConsoleEntry[] = [];

class PreviewConsoleBuffer {
  private readonly store = new SnapshotStore<readonly ConsoleEntry[]>(
    EMPTY_ENTRIES,
  );

  getSnapshot = this.store.getSnapshot;
  subscribe = this.store.subscribe;

  replace(appId: number, entries: readonly ConsoleEntry[]): void {
    this.store.setState(
      entries.length === 0
        ? EMPTY_ENTRIES
        : createPreviewConsoleTail(appId, EMPTY_ENTRIES, entries),
    );
  }

  append(appId: number, entries: readonly ConsoleEntry[]): void {
    if (entries.length === 0) return;
    this.store.setState(
      createPreviewConsoleTail(appId, this.store.getSnapshot(), entries),
    );
  }

  dispose(): void {
    this.store.dispose();
  }
}

/** Source boundary for local today and remote/main producers later. */
export interface PreviewConsoleSource {
  /** Remote intent: presentation append; delivery order is significant. */
  append(appId: number, entries: readonly ConsoleEntry[]): void;
  /** Remote intent: state-sensitive presentation reset. */
  clear(appId: number): void;
}

/** Provider-owned, app-keyed bounded preview log buffer. */
export class PreviewConsoleStore implements PreviewConsoleSource {
  private readonly host = new KeyedControllerHost<number, PreviewConsoleBuffer>(
    () => new PreviewConsoleBuffer(),
  );

  getSnapshot = (appId: number): readonly ConsoleEntry[] =>
    this.host.get(appId)?.getSnapshot() ?? EMPTY_ENTRIES;

  subscribeKey = (appId: number, listener: () => void): (() => void) =>
    this.host.subscribeKey(appId, listener);

  append(appId: number, entries: readonly ConsoleEntry[]): void {
    this.host.ensure(appId).append(appId, entries);
  }

  replace(appId: number, entries: readonly ConsoleEntry[]): void {
    if (entries.length === 0) {
      this.clear(appId);
      return;
    }
    this.host.ensure(appId).replace(appId, entries);
  }

  clear(appId: number): void {
    this.host.disposeKey(appId);
  }

  disposeKey = (appId: number): void => {
    this.host.disposeKey(appId);
  };

  dispose(): void {
    this.host.dispose();
  }
}

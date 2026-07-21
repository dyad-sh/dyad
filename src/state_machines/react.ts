import { useCallback, useSyncExternalStore } from "react";

export interface KeyedSnapshotSource<K, Snapshot> {
  subscribeKey(key: K, listener: () => void): () => void;
  getSnapshot(key: K): Snapshot;
}

export function useKeyedController<K, Snapshot>(
  source: KeyedSnapshotSource<K, Snapshot>,
  key: K,
): Snapshot {
  return useSyncExternalStore(
    useCallback(
      (listener) => source.subscribeKey(key, listener),
      [source, key],
    ),
    useCallback(() => source.getSnapshot(key), [source, key]),
  );
}

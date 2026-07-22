import { useCallback, useSyncExternalStore } from "react";
import type { KeyedController } from "./keyed_host";

export interface KeyedSnapshotSource<K, Snapshot> {
  subscribeKey(key: K, listener: () => void): () => void;
  getSnapshot(key: K): Snapshot;
}

function defaultSelectSnapshot<K, Snapshot>(
  source: KeyedSnapshotSource<K, Snapshot>,
  key: K,
): Snapshot {
  return source.getSnapshot(key);
}

export function useKeyedController<K, Snapshot>(
  source: KeyedSnapshotSource<K, Snapshot>,
  key: K,
  selectSnapshot: (
    source: KeyedSnapshotSource<K, Snapshot>,
    key: K,
  ) => Snapshot = defaultSelectSnapshot,
): Snapshot {
  return useSyncExternalStore(
    useCallback(
      (listener) => source.subscribeKey(key, listener),
      [source, key],
    ),
    useCallback(
      () => selectSnapshot(source, key),
      [source, key, selectSnapshot],
    ),
  );
}

/** React binding for a controller that does not need keyed host selection. */
export function useControllerSnapshot<Snapshot>(
  controller: KeyedController<Snapshot>,
): Snapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}

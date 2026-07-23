import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { KeyedController } from "./keyed_host";

export interface DisposableManager {
  start?(): void;
  dispose(): void;
}

/**
 * Starts a manager after commit and disposes it after its final unmount.
 *
 * React StrictMode immediately replays effects without recreating hook state,
 * so irreversible disposal is deferred until a replayed setup has had a
 * chance to claim the same manager. A genuinely replaced manager is still
 * disposed even though the new manager's effect has already started.
 */
export function useManagerLifecycle(manager: DisposableManager): void {
  const lifecycle = useRef({
    generations: new Map<DisposableManager, number>(),
  });

  useEffect(() => {
    const generation = (lifecycle.current.generations.get(manager) ?? 0) + 1;
    lifecycle.current.generations.set(manager, generation);
    manager.start?.();

    return () => {
      queueMicrotask(() => {
        const current = lifecycle.current;
        if (current.generations.get(manager) === generation) {
          current.generations.delete(manager);
          manager.dispose();
        }
      });
    };
  }, [manager]);
}

/**
 * Disposes a renderer-owned manager before document teardown. React effect
 * cleanup is not guaranteed when Electron reloads or destroys the renderer.
 */
export function useManagerPagehideDisposal(manager: DisposableManager): void {
  useEffect(() => {
    const dispose = (event: PageTransitionEvent) => {
      if (!event.persisted) manager.dispose();
    };
    window.addEventListener("pagehide", dispose);
    return () => window.removeEventListener("pagehide", dispose);
  }, [manager]);
}

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

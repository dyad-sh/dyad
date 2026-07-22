import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type PropsWithChildren,
} from "react";
import { EntityDisposalRegistry, type EntityDisposer } from "./entity_disposal";
import type { KeyedController } from "./keyed_host";

export interface DisposableManager {
  start?(): void;
  dispose(): void;
}

type MachineProviderProps<M, OwnedProps extends object> = PropsWithChildren<
  | ({ manager: M } & Partial<OwnedProps>)
  | ({ manager?: undefined } & OwnedProps)
>;

export function createMachineProvider<
  M extends DisposableManager,
  OwnedProps extends object = object,
>(options: {
  name: string;
  useOwnedManager: (props: OwnedProps) => M;
  useOnMount?: (manager: M) => void;
}): {
  Provider: ComponentType<MachineProviderProps<M, OwnedProps>>;
  useManager: () => M;
} {
  const ManagerContext = createContext<M | null>(null);
  const useOwnedManager = options.useOwnedManager;
  const useOnMount = options.useOnMount ?? (() => undefined);

  function ManagerBoundary({
    manager,
    children,
  }: PropsWithChildren<{ manager: M }>) {
    useManagerLifecycle(manager);
    useOnMount(manager);
    return createElement(ManagerContext.Provider, { value: manager }, children);
  }

  function OwnedManagerBoundary({
    ownedProps,
    children,
  }: PropsWithChildren<{ ownedProps: OwnedProps }>) {
    const manager = useOwnedManager(ownedProps);
    return createElement(ManagerBoundary, { manager }, children);
  }

  function Provider(props: MachineProviderProps<M, OwnedProps>) {
    if (props.manager) {
      return createElement(
        ManagerBoundary,
        { manager: props.manager },
        props.children,
      );
    }
    return createElement(
      OwnedManagerBoundary,
      { ownedProps: props as OwnedProps },
      props.children,
    );
  }

  function useManager(): M {
    const manager = useContext(ManagerContext);
    if (!manager) {
      throw new Error(
        `use${options.name}Manager requires ${options.name}Provider`,
      );
    }
    return manager;
  }

  return { Provider, useManager };
}

const EntityDisposalContext = createContext<EntityDisposalRegistry | null>(
  null,
);

export function EntityDisposalProvider({ children }: PropsWithChildren) {
  const [registry] = useState(() => new EntityDisposalRegistry());
  return createElement(
    EntityDisposalContext.Provider,
    { value: registry },
    children,
  );
}

export function useEntityDisposal(): EntityDisposalRegistry {
  const registry = useContext(EntityDisposalContext);
  if (!registry) {
    throw new Error("useEntityDisposal requires EntityDisposalProvider");
  }
  return registry;
}

export function useRegisterEntityDisposer(
  scope: "app" | "chat",
  dispose: EntityDisposer,
): void {
  const registry = useContext(EntityDisposalContext);
  useEffect(() => {
    if (!registry) return;
    return scope === "app"
      ? registry.onAppDeleted(dispose)
      : registry.onChatDeleted(dispose);
  }, [dispose, registry, scope]);
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

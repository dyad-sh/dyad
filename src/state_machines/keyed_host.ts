export interface KeyedController<Snapshot = unknown> {
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Owns the lifecycle and subscriptions for controllers keyed by an entity. */
export class KeyedControllerHost<K, C extends KeyedController> {
  private readonly controllers = new Map<K, C>();
  private readonly controllerUnsubscribes = new Map<K, () => void>();
  private readonly keyListeners = new Map<K, Set<() => void>>();
  private readonly anyListeners = new Set<() => void>();
  private disposed = false;

  constructor(private readonly createController: (key: K) => C) {}

  ensure(key: K): C {
    const existing = this.controllers.get(key);
    if (existing) return existing;
    if (this.disposed) {
      throw new Error("Cannot create a controller on a disposed host");
    }
    const controller = this.createController(key);
    this.controllers.set(key, controller);
    this.controllerUnsubscribes.set(
      key,
      controller.subscribe(() => this.notify(key)),
    );
    return controller;
  }

  get(key: K): C | undefined {
    return this.controllers.get(key);
  }

  keys(): K[] {
    return [...this.controllers.keys()];
  }

  subscribeKey(key: K, listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    let listeners = this.keyListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.keyListeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.keyListeners.delete(key);
    };
  }

  subscribeAny(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  disposeKey(key: K): void {
    const controller = this.controllers.get(key);
    if (!controller) return;
    this.controllers.delete(key);
    this.controllerUnsubscribes.get(key)?.();
    this.controllerUnsubscribes.delete(key);
    controller.dispose();
    this.notify(key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.controllerUnsubscribes.values()) {
      unsubscribe();
    }
    for (const controller of this.controllers.values()) controller.dispose();
    this.controllers.clear();
    this.controllerUnsubscribes.clear();
    this.keyListeners.clear();
    this.anyListeners.clear();
  }

  private notify(key: K): void {
    for (const listener of this.keyListeners.get(key) ?? []) listener();
    for (const listener of this.anyListeners) listener();
  }
}
